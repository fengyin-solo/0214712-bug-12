/**
 * Courses.vue 组件集成测试
 *
 * 覆盖：
 * - 满员课程按钮禁用且不能报名
 * - 已报名课程显示"已报名"且不能重复提交
 * - 快速切换课程详情时，快照互不串改
 * - 报名提交过程中关闭弹框（取消支付）会中止请求，不产生记录
 * - 刷新后（重新挂载）我的课程/进度从持久化数据恢复，不重复显示
 * - 学习进度只更新对应课程
 */

import { describe, it, expect, beforeEach } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import { nextTick } from 'vue'
import Courses from '../views/Courses.vue'
import { login as authLogin } from '../utils/auth'
import taskStore from '../utils/taskStore'

// Modal/Teleport 结构较重，这里只断言组件内部状态与 taskStore，使用浅挂载替身
const globalStubs = {
  global: {
    stubs: {
      Modal: {
        props: ['modelValue', 'loading', 'confirmDisabled'],
        emits: ['update:modelValue', 'confirm', 'cancel'],
        template: '<div v-if="modelValue" class="stub-modal"><slot /></div>'
      },
      Toast: { template: '<div />' },
      LoginModal: {
        props: ['modelValue'],
        emits: ['update:modelValue', 'success'],
        template: '<div />'
      }
    }
  }
}

async function mountCourses() {
  const wrapper = mount(Courses, globalStubs)
  await flushPromises()
  return wrapper
}

beforeEach(async () => {
  localStorage.clear()
  taskStore.__reset()
  await authLogin('user', '123456')
})

describe('课程名额与重复报名', () => {
  it('满员课程（id=3）按钮显示"名额已满"且禁用', async () => {
    const wrapper = await mountCourses()
    const fullBtn = wrapper.findAll('.btn-enroll').find(b => b.text().includes('名额已满'))
    expect(fullBtn).toBeTruthy()
    expect(fullBtn.attributes('disabled')).toBeDefined()

    // 直接调用报名入口也应被拦截
    wrapper.vm.openEnrollModal(wrapper.vm.courses.find(c => c.id === 3))
    await flushPromises()
    expect(wrapper.vm.showEnrollModal).toBe(false)
    expect(taskStore.findActiveCourse(3)).toBeNull()
  })

  it('默认已报名课程（id=1）显示"已报名"，再次打开报名被拦截', async () => {
    const wrapper = await mountCourses()
    const enrolledBtn = wrapper.findAll('.btn-enroll').find(b => b.text().includes('已报名'))
    expect(enrolledBtn).toBeTruthy()
    expect(enrolledBtn.attributes('disabled')).toBeDefined()

    wrapper.vm.openEnrollModal(wrapper.vm.courses.find(c => c.id === 1))
    await flushPromises()
    expect(wrapper.vm.showEnrollModal).toBe(false)

    const count = taskStore.countActive('course', t => Number(t.extra?.courseId) === 1)
    expect(count).toBe(1)
  })

  it('重复点击确认支付只产生一条任务（loading 期间忽略 + API 去重）', async () => {
    const wrapper = await mountCourses()
    const course2 = wrapper.vm.courses.find(c => c.id === 2)

    wrapper.vm.openEnrollModal(course2)
    await flushPromises()
    const firstConfirm = wrapper.vm.confirmEnroll()
    // loading 中再次触发，应被直接忽略
    const secondConfirm = wrapper.vm.confirmEnroll()
    await Promise.all([firstConfirm, secondConfirm])
    await flushPromises()

    const count = taskStore.countActive('course', t => Number(t.extra?.courseId) === 2)
    expect(count).toBe(1)
  })
})

describe('快速切换详情不串改', () => {
  it('连续打开两门课详情，selectedCourse 始终是最后点击的课程', async () => {
    const wrapper = await mountCourses()
    wrapper.vm.openCourseDetail(wrapper.vm.courses[0])
    wrapper.vm.openCourseDetail(wrapper.vm.courses[1])
    await nextTick()

    expect(wrapper.vm.selectedCourse.id).toBe(2)
    expect(wrapper.vm.selectedCourse.name).toBe('斯诺克进阶训练')
    // 目录数据未被修改
    expect(wrapper.vm.courses[0].price).toBe(599)
    expect(wrapper.vm.courses[1].price).toBe(1299)
  })

  it('报名某课程时其名称/价格快照不被切换影响', async () => {
    const wrapper = await mountCourses()
    wrapper.vm.openEnrollModal(wrapper.vm.courses.find(c => c.id === 2))
    await flushPromises()
    // 打开报名框后再点击别的课程详情
    wrapper.vm.openCourseDetail(wrapper.vm.courses.find(c => c.id === 4))
    await flushPromises()
    await wrapper.vm.confirmEnroll()
    await flushPromises()

    const task = taskStore.findActiveCourse(2)
    expect(task).toBeTruthy()
    expect(task.title).toBe('斯诺克进阶训练')
    expect(task.amount).toBe(1299)
  })
})

describe('取消支付（提交中关闭）', () => {
  it('确认支付 loading 期间取消会中止请求，不写入任务', async () => {
    const wrapper = await mountCourses()
    wrapper.vm.openEnrollModal(wrapper.vm.courses.find(c => c.id === 2))
    await flushPromises()

    const promise = wrapper.vm.confirmEnroll()
    expect(wrapper.vm.enrollLoading).toBe(true)
    // 模拟用户点击 Modal 取消/关闭
    wrapper.vm.onEnrollCancel()
    await promise
    await flushPromises()

    expect(taskStore.findActiveCourse(2)).toBeNull()
    expect(wrapper.vm.showSuccessModal).toBe(false)
  })
})

describe('刷新恢复与进度隔离', () => {
  it('报名并学习后刷新（重新挂载），我的课程恢复且不重复、进度保留', async () => {
    const wrapper1 = await mountCourses()
    wrapper1.vm.openEnrollModal(wrapper1.vm.courses.find(c => c.id === 2))
    await flushPromises()
    await wrapper1.vm.confirmEnroll()
    await flushPromises()

    expect(taskStore.findActiveCourse(2)).toBeTruthy()

    // 模拟"开始学习"增加进度
    const myCourse = wrapper1.vm.myCourses.find(c => c.courseId === 2)
    wrapper1.vm.startStudy(myCourse)
    await flushPromises()
    expect(taskStore.getCourseProgress(2)).toBe(10)

    wrapper1.unmount()

    // 重新挂载等价于刷新页面
    const wrapper2 = await mountCourses()
    const restored = wrapper2.vm.myCourses.filter(c => c.courseId === 2)
    expect(restored.length).toBe(1)
    expect(restored[0].progress).toBe(10)
    expect(restored[0].courseName).toBe('斯诺克进阶训练')
    expect(restored[0].price).toBe(1299)

    // 默认课程 1 的进度不受影响
    const c1 = wrapper2.vm.myCourses.find(c => c.courseId === 1)
    expect(c1.progress).toBe(30)
  })

  it('课程详情（价格/教练/大纲）始终取自目录，任务记录不能改', async () => {
    const wrapper = await mountCourses()
    wrapper.vm.openEnrollModal(wrapper.vm.courses.find(c => c.id === 2))
    await flushPromises()
    await wrapper.vm.confirmEnroll()
    await flushPromises()

    const course2 = wrapper.vm.courses.find(c => c.id === 2)
    expect(course2.price).toBe(1299)
    expect(course2.coach).toBe('李强')
    expect(course2.outline.length).toBe(8)

    const task = taskStore.findActiveCourse(2)
    expect(task.extra.coach).toBe('李强')
  })
})
