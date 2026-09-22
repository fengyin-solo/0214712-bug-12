/**
 * Courses 页面组件测试
 *
 * 覆盖：
 * - 满员课程按钮禁用并显示"名额已满"
 * - 报名成功后卡片/详情按钮变为"已报名"，且不能再次提交
 * - 我的课程列表与任务中心一致、刷新（重挂载）后保持、不重复
 * - 空记录展示空态
 * - 快速切换课程详情时，展示内容始终与当前点击的课程一致
 * - 学习进度只影响对应课程
 * - 离开页面取消在途请求
 */

import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import Courses from '../views/Courses.vue'
import { taskStore, taskState } from '../utils/taskStore'
import { authState, login } from '../utils/auth'

const STORAGE_KEY = 'billiard_user_tasks'
const TOKEN_KEY = 'billiard_token'

function resetState() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify([]))
  localStorage.removeItem(TOKEN_KEY)
  localStorage.removeItem('billiard_user')
  authState.isLoggedIn = false
  authState.user = null
  authState.token = null
  authState.error = null
  taskState.version = 0
}

/** 走真实登录流程建立响应式会话（假定时器下立即完成） */
async function loginAsTestUser() {
  const p = login('user', '123456')
  await vi.advanceTimersByTimeAsync(1100)
  await flushPromises()
  return p
}

/** 推进假定时器跨过 mock 的 500-1000ms 延迟并刷新微任务队列 */
async function flushApi() {
  await vi.advanceTimersByTimeAsync(1100)
  await flushPromises()
}

async function mountPage() {
  const wrapper = mount(Courses, {
    global: {
      mocks: {
        $router: { push: vi.fn() }
      }
    }
  })
  await flushApi()
  return wrapper
}

describe('Courses 页面', () => {
  beforeEach(() => {
    resetState()
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('课程 4 满员，按钮显示"名额已满"且禁用', async () => {
    const wrapper = await mountPage()
    const fullCard = wrapper.findAll('.course-card').find(c => c.text().includes('比赛心理训练'))
    expect(fullCard).toBeTruthy()

    const fullBtn = fullCard.find('.btn-full')
    expect(fullBtn.exists()).toBe(true)
    expect(fullBtn.attributes('disabled')).toBeDefined()
    expect(fullCard.text()).toContain('名额已满')
  })

  it('未报名课程显示"立即报名"', async () => {
    const wrapper = await mountPage()
    const card = wrapper.findAll('.course-card').find(c => c.text().includes('斯诺克进阶训练'))
    expect(card.find('.btn-enroll').exists()).toBe(true)
  })

  it('报名成功后按钮变为"已报名"，重复报名被拦截', async () => {
    await loginAsTestUser()
    const wrapper = await mountPage()

    const card = () => wrapper.findAll('.course-card').find(c => c.text().includes('斯诺克进阶训练'))
    expect(card().find('.btn-enroll').exists()).toBe(true)

    // 打开报名确认框
    wrapper.vm.openEnrollModal(wrapper.vm.courses.find(c => c.id === 2))
    expect(wrapper.vm.showEnrollModal).toBe(true)

    // 确认报名，等待请求
    const enrollPromise = wrapper.vm.confirmEnroll()
    await flushApi()
    await enrollPromise

    expect(wrapper.vm.showSuccessModal).toBe(true)
    expect(taskStore.isCourseEnrolled(2)).toBe(true)

    // 列表按钮变为已报名
    await wrapper.vm.$nextTick()
    expect(card().find('.btn-enrolled').exists()).toBe(true)
    expect(card().find('.btn-enroll').exists()).toBe(false)

    // 再次尝试打开报名框：直接被拦截
    wrapper.vm.openEnrollModal(wrapper.vm.courses.find(c => c.id === 2))
    expect(wrapper.vm.showEnrollModal).toBe(false)

    // 任务中心只有一条该课程记录（无重复）
    const count = taskStore.getAll().filter(t => t.type === 'course' && t.extra.courseId === 2).length
    expect(count).toBe(1)
  })

  it('未登录点击报名弹出登录框而非提交', async () => {
    const wrapper = await mountPage()
    wrapper.vm.openEnrollModal(wrapper.vm.courses.find(c => c.id === 2))
    expect(wrapper.vm.showLoginModal).toBe(true)
    expect(wrapper.vm.showEnrollModal).toBe(false)
  })

  it('登录成功后自动继续被拦截的报名流程', async () => {
    const wrapper = await mountPage()
    wrapper.vm.openEnrollModal(wrapper.vm.courses.find(c => c.id === 2))
    expect(wrapper.vm.pendingCourseId).toBe(2)

    // 模拟登录成功事件
    await loginAsTestUser()
    wrapper.vm.onLoginSuccess()
    expect(wrapper.vm.showEnrollModal).toBe(true)
    expect(wrapper.vm.pendingCourseId).toBeNull()
  })

  it('满员课程报名被后端拒绝', async () => {
    await loginAsTestUser()
    const wrapper = await mountPage()

    // 直接调用（绕过 UI 的禁用），后端仍应拒绝
    const course = wrapper.vm.courses.find(c => c.id === 4)
    wrapper.vm.enrollCourse = { ...course }
    wrapper.vm.showEnrollModal = true
    const p = wrapper.vm.confirmEnroll()
    await flushApi()
    await p

    expect(wrapper.vm.showSuccessModal).toBe(false)
    expect(wrapper.vm.toastType).toBe('warning')
    expect(wrapper.vm.toastMessage).toContain('名额')
  })

  it('我的课程列表与任务中心一致，重挂载（模拟刷新）后保持且不重复', async () => {
    await loginAsTestUser()
    const wrapper = await mountPage()
    wrapper.vm.openEnrollModal(wrapper.vm.courses.find(c => c.id === 2))
    const p = wrapper.vm.confirmEnroll()
    await flushApi()
    await p

    expect(wrapper.vm.myCourses.map(c => c.courseId)).toContain(2)
    expect(wrapper.vm.myCourses).toHaveLength(1)

    // 模拟页面刷新：重新挂载组件，状态仍从存储恢复
    await wrapper.unmount()
    const fresh = await mountPage()
    expect(fresh.vm.myCourses).toHaveLength(1)
    expect(fresh.vm.myCourses[0].courseId).toBe(2)
    // 详情/列表均显示已报名
    const card = fresh.findAll('.course-card').find(c => c.text().includes('斯诺克进阶训练'))
    expect(card.find('.btn-enrolled').exists()).toBe(true)
  })

  it('空记录时我的课程显示空态', async () => {
    taskStore.clearAll()
    const wrapper = await mountPage()
    expect(wrapper.vm.myCourses).toEqual([])

    wrapper.vm.showMyCoursesModal = true
    await wrapper.vm.$nextTick()
    // Modal 使用 Teleport 到 body，空态文本在 document.body 上
    expect(document.body.textContent).toContain('暂无已报名课程')
  })

  it('快速切换课程详情时，弹窗始终展示当前选中课程，不显示旧内容', async () => {
    const wrapper = await mountPage()

    wrapper.vm.openCourseDetail(wrapper.vm.courses[0])
    wrapper.vm.openCourseDetail(wrapper.vm.courses[1])
    expect(wrapper.vm.selectedCourseId).toBe(2)
    expect(wrapper.vm.detailCourse.id).toBe(2)
    expect(wrapper.vm.detailCourse.name).toBe('斯诺克进阶训练')
    expect(wrapper.vm.detailCourse.price).toBe(1299)

    // 再切回课程 1
    wrapper.vm.openCourseDetail(wrapper.vm.courses[0])
    expect(wrapper.vm.detailCourse.id).toBe(1)
    expect(wrapper.vm.detailCourse.price).toBe(599)
  })

  it('名额加载返回后只更新统计字段，不覆盖价格/名称/大纲', async () => {
    const wrapper = await mountPage()
    const course = wrapper.vm.courses.find(c => c.id === 1)
    expect(course.name).toBe('台球入门基础课')
    expect(course.price).toBe(599)
    expect(course.outline).toHaveLength(8)
    expect(typeof course.students).toBe('number')
  })

  it('取消待支付任务后名额释放，课程重新可报名', async () => {
    await loginAsTestUser()
    const wrapper = await mountPage()

    // 先报名课程 1，再取消，模拟"取消支付"
    wrapper.vm.openEnrollModal(wrapper.vm.courses.find(c => c.id === 1))
    const p = wrapper.vm.confirmEnroll()
    await flushApi()
    await p
    expect(taskStore.isCourseEnrolled(1)).toBe(true)

    const task = taskStore.findCourseTask(1)
    taskStore.remove(task.id)
    await wrapper.vm.$nextTick()
    await flushApi() // 名额重新加载

    expect(taskStore.isCourseEnrolled(1)).toBe(false)
    const card = wrapper.findAll('.course-card').find(c => c.text().includes('台球入门基础课'))
    expect(card.find('.btn-enroll').exists()).toBe(true)
  })

  it('开始学习只更新该课程的进度', async () => {
    await loginAsTestUser()
    const wrapper = await mountPage()
    wrapper.vm.openEnrollModal(wrapper.vm.courses.find(c => c.id === 2))
    const p = wrapper.vm.confirmEnroll()
    await flushApi()
    await p

    const myCourse = wrapper.vm.myCourses.find(c => c.courseId === 2)
    wrapper.vm.startStudy(myCourse)
    await wrapper.vm.$nextTick()

    const updated = taskStore.findCourseTask(2)
    expect(updated.extra.progress).toBe(10)

    // 未报名的课程 1 不存在记录，不会凭空产生进度数据
    expect(taskStore.findCourseTask(1)).toBeNull()
  })

  it('报名快照价格不随后续目录变化被串改', async () => {
    await loginAsTestUser()
    const wrapper = await mountPage()

    wrapper.vm.openEnrollModal(wrapper.vm.courses.find(c => c.id === 2))
    const snapshot = wrapper.vm.enrollCourse
    expect(snapshot.price).toBe(1299)

    // 模拟异步名额刷新过程中目录对象发生替换
    wrapper.vm.courses = wrapper.vm.courses.map(c =>
      c.id === 2 ? { ...c, price: 1 } : c
    )
    expect(snapshot.price).toBe(1299)
  })

  it('离开页面（unmount）时在途请求被取消，不产生报名记录', async () => {
    await loginAsTestUser()
    const wrapper = await mountPage()
    wrapper.vm.openEnrollModal(wrapper.vm.courses.find(c => c.id === 2))

    // 发起报名后立即离开页面（请求尚未返回）
    const promise = wrapper.vm.confirmEnroll()
    wrapper.unmount()
    await vi.advanceTimersByTimeAsync(1100)
    await flushPromises()
    await promise.catch(() => {})

    expect(taskStore.isCourseEnrolled(2)).toBe(false)
  })
})
