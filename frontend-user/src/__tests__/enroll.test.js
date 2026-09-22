/**
 * 课程报名 / 任务操作 API 测试
 *
 * 覆盖：
 * - 课程目录含名额字段（capacity/full/availableSpots）
 * - 满员课程拒绝报名（409 CAPACITY_FULL）
 * - 未登录写操作返回会话失效（401 SESSION_EXPIRED）
 * - 重复报名幂等拒绝（409 ALREADY_ENROLLED）
 * - AbortSignal 取消请求（快速切换/离开页面）
 */

import { describe, it, expect, beforeEach, vi } from 'vitest'
import { api, REQUEST_ABORTED_CODE, onUnauthorized } from '../utils/api'
import { taskStore, taskState } from '../utils/taskStore'

const STORAGE_KEY = 'billiard_user_tasks'
const TOKEN_KEY = 'billiard_token'

function resetState() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify([]))
  localStorage.removeItem(TOKEN_KEY)
  taskState.version = 0
}

describe('课程与任务 API', () => {
  beforeEach(() => {
    resetState()
  })

  describe('api.getCourses', () => {
    it('返回 4 门课程并包含名额字段', async () => {
      const result = await api.getCourses()
      expect(result.success).toBe(true)
      expect(result.data).toHaveLength(4)
      const course = result.data[0]
      expect(course).toHaveProperty('capacity')
      expect(course).toHaveProperty('availableSpots')
      expect(course).toHaveProperty('full')
      expect(typeof course.full).toBe('boolean')
    })

    it('课程 4 名额已满（students === capacity）', async () => {
      const result = await api.getCourses()
      const fullCourse = result.data.find(c => c.id === 4)
      expect(fullCourse.full).toBe(true)
      expect(fullCourse.availableSpots).toBe(0)
    })

    it('本地有效报名会占用名额', async () => {
      localStorage.setItem(TOKEN_KEY, 'mock_token_test')
      const before = (await api.getCourses()).data.find(c => c.id === 1)
      const beforeEnrolled = before.enrolledCount

      const res = await api.enrollCourse({ courseId: 1 })
      // 视图在接口成功后落库
      taskStore.addCourseTask({ id: 1, name: res.data.courseName, price: res.data.price }, { orderNo: res.data.orderNo, expireDate: res.data.expireDate })

      const after = (await api.getCourses()).data.find(c => c.id === 1)
      expect(after.enrolledCount).toBe(beforeEnrolled + 1)
      expect(after.availableSpots).toBe(before.availableSpots - 1)
    })

    it('取消报名后名额回滚', async () => {
      localStorage.setItem(TOKEN_KEY, 'mock_token_test')
      const res = await api.enrollCourse({ courseId: 1 })
      taskStore.addCourseTask({ id: 1, name: res.data.courseName, price: res.data.price }, { orderNo: res.data.orderNo, expireDate: res.data.expireDate })
      const whileEnrolled = (await api.getCourses()).data.find(c => c.id === 1)
      const task = taskStore.findCourseTask(1)
      expect(task).toBeTruthy()

      taskStore.remove(task.id)

      const afterCancel = (await api.getCourses()).data.find(c => c.id === 1)
      expect(afterCancel.enrolledCount).toBe(whileEnrolled.enrolledCount - 1)
    })
  })

  describe('api.enrollCourse', () => {
    it('未登录返回 SESSION_EXPIRED', async () => {
      const result = await api.enrollCourse({ courseId: 1 })
      expect(result.success).toBe(false)
      expect(result.code).toBe('SESSION_EXPIRED')
      expect(taskStore.isCourseEnrolled(1)).toBe(false)
    })

    it('登录后报名成功并返回订单信息', async () => {
      localStorage.setItem(TOKEN_KEY, 'mock_token_test')
      const result = await api.enrollCourse({ courseId: 1 })
      expect(result.success).toBe(true)
      expect(result.data.orderNo).toMatch(/^CR\d+$/)
      expect(result.data.courseId).toBe(1)
      expect(result.data.courseName).toBe('台球入门基础课')
      expect(result.data.price).toBe(599)
      expect(result.data.expireDate).toMatch(/^\d{4}-\d{2}-\d{2}$/)
    })

    it('重复报名被幂等拒绝', async () => {
      localStorage.setItem(TOKEN_KEY, 'mock_token_test')
      const first = await api.enrollCourse({ courseId: 1 })
      expect(first.success).toBe(true)
      // 视图在首次成功后落库
      taskStore.addCourseTask({ id: 1, name: first.data.courseName, price: first.data.price }, { orderNo: first.data.orderNo, expireDate: first.data.expireDate })

      const second = await api.enrollCourse({ courseId: 1 })
      expect(second.success).toBe(false)
      expect(second.code).toBe('ALREADY_ENROLLED')
      expect(second.error).toContain('重复')
    })

    it('满员课程报名返回 CAPACITY_FULL', async () => {
      localStorage.setItem(TOKEN_KEY, 'mock_token_test')
      const result = await api.enrollCourse({ courseId: 4 })
      expect(result.success).toBe(false)
      expect(result.code).toBe('CAPACITY_FULL')
      expect(result.error).toContain('名额')
    })

    it('不存在的课程返回 NOT_FOUND', async () => {
      localStorage.setItem(TOKEN_KEY, 'mock_token_test')
      const result = await api.enrollCourse({ courseId: 9999 })
      expect(result.success).toBe(false)
      expect(result.code).toBe('NOT_FOUND')
    })

    it('AbortSignal 取消后返回 aborted 结果', async () => {
      localStorage.setItem(TOKEN_KEY, 'mock_token_test')
      const controller = new AbortController()
      const promise = api.enrollCourse({ courseId: 1, signal: controller.signal })
      controller.abort()

      const result = await promise
      expect(result.success).toBe(false)
      expect(result.aborted).toBe(true)
      expect(result.code).toBe(REQUEST_ABORTED_CODE)
      // 取消不会产生报名记录
      expect(taskStore.isCourseEnrolled(1)).toBe(false)
    })
  })

  describe('赛事报名', () => {
    it('未登录报名赛事返回 SESSION_EXPIRED', async () => {
      const result = await api.joinCompetition({ competitionId: 1 })
      expect(result.success).toBe(false)
      expect(result.code).toBe('SESSION_EXPIRED')
    })

    it('满员赛事（id=2 ongoing 已满员）返回 CAPACITY_FULL', async () => {
      localStorage.setItem(TOKEN_KEY, 'mock_token_test')
      const result = await api.joinCompetition({ competitionId: 2 })
      expect(result.success).toBe(false)
      expect(result.code).toBe('CAPACITY_FULL')
    })

    it('正常赛事报名成功', async () => {
      localStorage.setItem(TOKEN_KEY, 'mock_token_test')
      const result = await api.joinCompetition({ competitionId: 1 })
      expect(result.success).toBe(true)
      expect(result.data.regNo).toMatch(/^REG\d+$/)
      expect(result.data.playerNo).toBeGreaterThanOrEqual(1)
    })

    it('重复报名赛事被拒绝', async () => {
      localStorage.setItem(TOKEN_KEY, 'mock_token_test')
      const first = await api.joinCompetition({ competitionId: 1 })
      expect(first.success).toBe(true)
      // 视图在首次成功后落库
      taskStore.addCompetitionTask(
        { id: 1, name: first.data.compName, fee: 200, status: 'upcoming', date: '2026-03-15' },
        { regNo: first.data.regNo, playerNo: first.data.playerNo }
      )
      const second = await api.joinCompetition({ competitionId: 1 })
      expect(second.success).toBe(false)
      expect(second.code).toBe('ALREADY_ENROLLED')
    })
  })

  describe('任务操作会话校验', () => {
    it('未登录执行支付返回会话失效', async () => {
      const result = await api.doTaskAction({ taskId: 'T1', action: 'pay' })
      expect(result.success).toBe(false)
      expect(result.code).toBe('SESSION_EXPIRED')
    })

    it('登录后支付/取消通过任务存储生效', async () => {
      localStorage.setItem(TOKEN_KEY, 'mock_token_test')
      const course = { id: 3, name: '九球高级技巧', price: 1999 }
      const task = taskStore.addCourseTask(course, { orderNo: 'C1', status: 'pending_payment' })

      const pay = await api.doTaskAction({ taskId: task.id, action: 'pay' })
      expect(pay.success).toBe(true)
      expect(pay.data.success).toBe(true)
      expect(taskStore.getById(task.id).status).toBe('upcoming')

      const cancel = await api.doTaskAction({ taskId: task.id, action: 'cancel' })
      expect(cancel.data.success).toBe(true)
      expect(taskStore.getById(task.id)).toBeNull()
    })
  })

  describe('登录失效广播', () => {
    it('未授权写操作触发 onUnauthorized 监听', async () => {
      const handler = vi.fn()
      const off = onUnauthorized(handler)
      await api.enrollCourse({ courseId: 1 })
      expect(handler).toHaveBeenCalled()
      off()
    })
  })
})
