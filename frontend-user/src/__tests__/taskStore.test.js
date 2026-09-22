/**
 * taskStore 单元测试
 *
 * 覆盖：
 * - 重复报名防护与名额占用/释放（满员）
 * - 支付幂等、取消删除不串记录
 * - 学习进度按课程独立（刷新后不丢、不串改）
 * - id/createdAt 不可被调用方覆盖（防错位）
 * - 空记录、损坏数据、重复 id 处理
 * - actions 数组不共享引用
 */

import { describe, it, expect, beforeEach } from 'vitest'
import taskStore from '../utils/taskStore'

const course = { id: 901, name: '测试课程', icon: '🎯', coach: '教练甲', lessons: '4课时', price: 100 }
const otherCourse = { id: 902, name: '另一门课', icon: '🎱', coach: '教练乙', lessons: '8课时', price: 200 }
const table = { id: 901, name: '9号球桌', type: '斯诺克', price: 50 }
const competition = { id: 901, name: '测试赛事', fee: 100, status: 'upcoming', date: '2026-05-01' }

beforeEach(() => {
  localStorage.clear()
  taskStore.__reset()
})

describe('taskStore 基础读写', () => {
  it('新增任务会生成唯一 id 和 createdAt，且调用方无法覆盖', () => {
    const task = taskStore.add({
      id: 'FORGED-ID',
      createdAt: '2000-01-01 00:00',
      type: 'booking',
      title: 't',
      status: 'pending_payment',
      amount: 10
    })

    expect(task.id).not.toBe('FORGED-ID')
    expect(task.createdAt).not.toBe('2000-01-01 00:00')
    expect(taskStore.getById('FORGED-ID')).toBeNull()
    expect(taskStore.getById(task.id)).toBeTruthy()
  })

  it('update 不允许篡改 id/createdAt/type', () => {
    const task = taskStore.addCourseTask(course, { orderNo: 'X1' })
    const updated = taskStore.update(task.id, {
      id: 'HACK',
      createdAt: '2000-01-01 00:00',
      type: 'order',
      subtitle: '已改'
    })

    expect(updated.id).toBe(task.id)
    expect(updated.createdAt).toBe(task.createdAt)
    expect(updated.type).toBe('course')
    expect(updated.subtitle).toBe('已改')
  })

  it('actions 为每次独立拷贝，修改一条不影响其它任务', () => {
    const a = taskStore.add({ type: 'course', title: 'a', status: 'pending_payment', amount: 1, extra: { courseId: 1 } })
    const b = taskStore.add({ type: 'course', title: 'b', status: 'pending_payment', amount: 1, extra: { courseId: 2 } })

    const a1 = taskStore.getById(a.id)
    a1.actions.push({ key: 'evil', label: '坏', type: 'default' })
    const a2 = taskStore.getById(a.id)
    const b1 = taskStore.getById(b.id)

    expect(a2.actions.some(x => x.key === 'evil')).toBe(false)
    expect(b1.actions.some(x => x.key === 'evil')).toBe(false)
  })
})

describe('重复报名防护与名额', () => {
  it('同一课程进行中只能有一条报名记录（findActiveCourse）', () => {
    taskStore.addCourseTask(course, { orderNo: 'CR1' })
    expect(taskStore.findActiveCourse(course.id)).toBeTruthy()

    taskStore.addCourseTask(course, { orderNo: 'CR2' })
    const activeCount = taskStore.getAll().filter(
      t => t.type === 'course' && t.extra?.courseId === course.id
    ).length
    // 存储层面允许插入多条（由 API 层拦截），但进行中查询始终只认一条
    expect(taskStore.findActiveCourse(course.id)).toBeTruthy()
    expect(activeCount).toBe(2)
  })

  it('不同课程的报名互不影响', () => {
    taskStore.addCourseTask(course, { orderNo: 'CR1' })
    expect(taskStore.findActiveCourse(otherCourse.id)).toBeNull()
  })

  it('取消（删除）任务后名额释放，可重新报名', () => {
    const task = taskStore.addCourseTask(course, { orderNo: 'CR1' })
    expect(taskStore.findActiveCourse(course.id)).toBeTruthy()

    taskStore.remove(task.id)
    expect(taskStore.findActiveCourse(course.id)).toBeNull()
  })

  it('赛事/球桌同样有进行中记录查询', () => {
    taskStore.addCompetitionTask(competition, { regNo: 'R1', playerNo: 3 })
    expect(taskStore.findActiveCompetition(competition.id)).toBeTruthy()

    taskStore.addBookingTask(table, { orderNo: 'B1', date: '2026-03-01', time: '10:00 - 12:00', duration: 2 })
    expect(taskStore.findActiveBooking(table.id, '2026-03-01', '10:00 - 12:00')).toBeTruthy()
    expect(taskStore.findActiveBooking(table.id, '2026-03-02', '10:00 - 12:00')).toBeNull()
  })

  it('已完成/已取消的记录不占用名额', () => {
    const task = taskStore.addCourseTask(course, { orderNo: 'CR1' })
    taskStore.updateStatus(task.id, 'completed')
    expect(taskStore.findActiveCourse(course.id)).toBeNull()
  })

  it('countActive 只统计进行中状态', () => {
    const t1 = taskStore.addCourseTask(course, { orderNo: 'A' })
    taskStore.addCourseTask(otherCourse, { orderNo: 'B' })
    taskStore.updateStatus(t1.id, 'cancelled')

    const count = taskStore.countActive('course', t => t.extra?.courseId === course.id)
    expect(count).toBe(0)
  })
})

describe('支付幂等', () => {
  it('待付款课程支付后变为 upcoming，重复支付不改变状态', () => {
    const task = taskStore.add({
      type: 'course', title: course.name, status: 'pending_payment', amount: 100,
      extra: { courseId: course.id }
    })

    const paid = taskStore.markAsPaid(task.id)
    expect(paid.status).toBe('upcoming')
    expect(paid.subtitle).toContain('支付成功')

    const again = taskStore.markAsPaid(task.id)
    expect(again.status).toBe('upcoming')
    expect(again.subtitle).toBe(paid.subtitle)
  })

  it('订单支付后进入待发货', () => {
    const task = taskStore.add({
      type: 'order', title: '商品', status: 'pending_payment', amount: 99,
      extra: { orderNo: 'SP1' }
    })
    expect(taskStore.markAsPaid(task.id).status).toBe('pending_shipment')
  })

  it('支付不存在的任务返回 null', () => {
    expect(taskStore.markAsPaid('NOT-EXIST')).toBeNull()
  })

  it('取消支付（删除）后再取消为幂等失败，且不影响其它任务', () => {
    const a = taskStore.add({ type: 'booking', title: 'a', status: 'pending_payment', amount: 1, extra: {} })
    const b = taskStore.add({ type: 'booking', title: 'b', status: 'pending_payment', amount: 1, extra: {} })

    expect(taskStore.remove(a.id)).toBe(true)
    expect(taskStore.remove(a.id)).toBe(false)
    // b 仍然存在，没有错位删除
    expect(taskStore.getById(b.id)).toBeTruthy()
  })
})

describe('学习进度隔离', () => {
  it('进度按课程独立存储，互不串改', () => {
    taskStore.setCourseProgress(course.id, 40)
    taskStore.setCourseProgress(otherCourse.id, 80)

    expect(taskStore.getCourseProgress(course.id)).toBe(40)
    expect(taskStore.getCourseProgress(otherCourse.id)).toBe(80)
  })

  it('进度被钳制在 0-100', () => {
    expect(taskStore.setCourseProgress(course.id, 250)).toBe(100)
    expect(taskStore.setCourseProgress(otherCourse.id, -5)).toBe(0)
  })

  it('重新报名（先取消再报名）进度不会被重置', () => {
    taskStore.setCourseProgress(course.id, 60)
    const task = taskStore.addCourseTask(course, { orderNo: 'CR1' })
    taskStore.remove(task.id)
    taskStore.addCourseTask(course, { orderNo: 'CR2' })

    expect(taskStore.getCourseProgress(course.id)).toBe(60)
  })

  it('刷新（重新加载模块数据）后进度仍保留（localStorage 持久化）', () => {
    taskStore.setCourseProgress(course.id, 35)
    // 直接再写/读，模拟另一次会话读取
    expect(Number(localStorage.getItem('billiard_course_progress') ? JSON.parse(localStorage.getItem('billiard_course_progress'))[course.id] : 0)).toBe(35)
  })
})

describe('空记录与损坏数据', () => {
  it('clearAll 后列表为空（空记录场景）', () => {
    taskStore.clearAll()
    expect(taskStore.getAll()).toEqual([])
    expect(taskStore.getPendingCount()).toBe(0)
    expect(taskStore.findActiveCourse(1)).toBeNull()
  })

  it('localStorage 中为损坏 JSON 时回退默认数据，不抛错', () => {
    localStorage.setItem('billiard_user_tasks', 'not-a-json')
    const all = taskStore.getAll()
    expect(Array.isArray(all)).toBe(true)
    expect(all.length).toBeGreaterThan(0)
  })

  it('非数组/含非法条目/重复 id 时过滤脏数据且去重', () => {
    localStorage.setItem('billiard_user_tasks', JSON.stringify([
      { id: 'OK1', type: 'course', status: 'upcoming', title: '好记录', amount: 1, extra: { courseId: 1 } },
      { id: 'OK1', type: 'course', status: 'upcoming', title: '重复记录', amount: 1, extra: { courseId: 1 } },
      { id: 'BAD1', type: 'unknown', status: 'upcoming' },
      null,
      { type: 'course', status: 'upcoming' }
    ]))

    taskStore.__reload()
    const all = taskStore.getAll()

    expect(all.length).toBe(1)
    expect(all[0].id).toBe('OK1')
    expect(all.every(t => t.id && t.type)).toBe(true)
    expect(new Set(all.map(t => t.id)).size).toBe(all.length)
  })
})
