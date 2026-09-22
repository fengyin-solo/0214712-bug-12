<template>
  <div class="courses-page">
    <header class="page-header">
      <div class="header-content">
        <span class="page-tag">专业培训</span>
        <h1>教学课程</h1>
        <p>专业教练团队，助您快速提升球技</p>
      </div>
    </header>

    <div class="courses-grid">
      <div 
        v-for="course in courses" 
        :key="course.id" 
        class="course-card"
        @click="openCourseDetail(course)"
      >
        <div class="card-visual">
          <div class="visual-bg" :style="{ background: course.gradient }"></div>
          <div class="course-icon">{{ course.icon }}</div>
          <div class="level-badge">{{ course.level }}</div>
        </div>
        
        <div class="card-content">
          <div class="course-meta">
            <span class="duration">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <circle cx="12" cy="12" r="10"/>
                <path d="M12 6v6l4 2"/>
              </svg>
              {{ course.duration }}
            </span>
            <span class="students">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/>
                <circle cx="9" cy="7" r="4"/>
                <path d="M23 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75"/>
              </svg>
              {{ displayStudents(course) }}/{{ course.maxStudents }}人
            </span>
          </div>

          <h3>{{ course.name }}</h3>
          <p class="description">{{ course.description }}</p>

          <div class="coach-info">
            <div class="coach-avatar">{{ course.coach.charAt(0) }}</div>
            <div class="coach-details">
              <span class="coach-name">{{ course.coach }}</span>
              <span class="coach-title">{{ course.coachTitle }}</span>
            </div>
          </div>

          <div class="card-footer">
            <div class="price">
              <span class="amount">¥{{ course.price }}</span>
              <span v-if="course.originalPrice" class="original">¥{{ course.originalPrice }}</span>
            </div>
            <button
              class="btn-enroll"
              :class="{ enrolled: isEnrolled(course), full: isFull(course) }"
              :disabled="isEnrolled(course) || isFull(course)"
              @click.stop="openEnrollModal(course)"
            >
              <span>{{ enrollButtonText(course) }}</span>
              <svg v-if="!isEnrolled(course) && !isFull(course)" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <path d="M5 12h14M12 5l7 7-7 7"/>
              </svg>
              <svg v-else viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <polyline points="20 6 9 17 4 12"/>
              </svg>
            </button>
          </div>
        </div>
        
        <div class="card-hover-effect"></div>
      </div>
    </div>

    <!-- Course Detail Modal -->
    <Modal
      v-model="showDetailModal"
      size="large"
      :show-footer="false"
    >
      <div v-if="selectedCourse" class="course-detail">
        <div class="detail-header" :style="{ background: selectedCourse.gradient }">
          <div class="detail-icon">{{ selectedCourse.icon }}</div>
          <div class="detail-badge">{{ selectedCourse.level }}</div>
        </div>
        
        <div class="detail-content">
          <h2>{{ selectedCourse.name }}</h2>
          <p class="detail-desc">{{ selectedCourse.description }}</p>
          
          <div class="detail-stats">
            <div class="stat">
              <span class="stat-value">{{ selectedCourse.duration }}</span>
              <span class="stat-label">课程时长</span>
            </div>
            <div class="stat">
              <span class="stat-value">{{ selectedCourse.lessons }}</span>
              <span class="stat-label">课时数量</span>
            </div>
            <div class="stat">
              <span class="stat-value">{{ displayStudents(selectedCourse) }}/{{ selectedCourse.maxStudents }}</span>
              <span class="stat-label">报名情况</span>
            </div>
          </div>
          
          <div class="detail-coach">
            <div class="coach-avatar large">{{ selectedCourse.coach.charAt(0) }}</div>
            <div class="coach-info">
              <h4>{{ selectedCourse.coach }}</h4>
              <span class="title">{{ selectedCourse.coachTitle }}</span>
              <p class="bio">{{ selectedCourse.coachBio }}</p>
            </div>
          </div>
          
          <div class="course-outline">
            <h4>课程大纲</h4>
            <div class="outline-list">
              <div v-for="(item, index) in selectedCourse.outline" :key="index" class="outline-item">
                <span class="outline-num">{{ String(index + 1).padStart(2, '0') }}</span>
                <span class="outline-text">{{ item }}</span>
              </div>
            </div>
          </div>
          
          <div class="detail-footer">
            <div class="detail-price">
              <span class="current">¥{{ selectedCourse.price }}</span>
              <span v-if="selectedCourse.originalPrice" class="original">¥{{ selectedCourse.originalPrice }}</span>
            </div>
            <button
              class="btn-enroll-large"
              :class="{ enrolled: isEnrolled(selectedCourse), full: isFull(selectedCourse) }"
              :disabled="isEnrolled(selectedCourse) || isFull(selectedCourse)"
              @click="openEnrollModal(selectedCourse)"
            >
              {{ enrollButtonText(selectedCourse) }}
            </button>
          </div>
        </div>
      </div>
    </Modal>

    <!-- Enroll Modal -->
    <Modal
      v-model="showEnrollModal"
      icon="📚"
      icon-type="info"
      title="确认报名"
      :subtitle="enrollCourse?.name"
      size="small"
      confirm-text="确认支付"
      :loading="enrollLoading"
      :confirm-disabled="enrollLoading"
      :close-on-overlay="!enrollLoading"
      @confirm="confirmEnroll"
      @cancel="onEnrollCancel"
    >
      <div v-if="enrollCourse" class="enroll-info">
        <div class="info-row">
          <span class="label">课程</span>
          <span class="value">{{ enrollCourse.name }}</span>
        </div>
        <div class="info-row">
          <span class="label">教练</span>
          <span class="value">{{ enrollCourse.coach }}</span>
        </div>
        <div class="info-row">
          <span class="label">课时</span>
          <span class="value">{{ enrollCourse.lessons }}</span>
        </div>
        <div class="info-row">
          <span class="label">剩余名额</span>
          <span class="value" :class="{ 'full-text': isFull(enrollCourse) }">
            {{ isFull(enrollCourse) ? '已满' : remainingSeats(enrollCourse) + ' 个名额' }}
          </span>
        </div>
        <div class="info-row total">
          <span class="label">应付金额</span>
          <span class="value price">¥{{ enrollCourse.price }}</span>
        </div>
        <p v-if="enrollLoading" class="request-tip">报名提交中，请勿关闭或重复点击…</p>
      </div>
    </Modal>

    <!-- Success Modal -->
    <Modal
      v-model="showSuccessModal"
      icon="🎉"
      icon-type="success"
      title="报名成功"
      subtitle="课程已添加到您的学习列表"
      size="small"
      :show-cancel="false"
      confirm-text="开始学习"
      @confirm="goToMyCourses"
    >
      <div v-if="enrollResult" class="success-info">
        <div class="info-row">
          <span class="label">订单编号</span>
          <span class="value">{{ enrollResult.orderNo }}</span>
        </div>
        <div class="info-row">
          <span class="label">课程</span>
          <span class="value">{{ enrollResult.courseName }}</span>
        </div>
        <div class="info-row">
          <span class="label">有效期至</span>
          <span class="value">{{ enrollResult.expireDate }}</span>
        </div>
      </div>
    </Modal>

    <!-- Toast -->
    <Toast v-model="showToast" :type="toastType" :title="toastTitle" :message="toastMessage" />

    <!-- Login Modal -->
    <LoginModal v-model="showLoginModal" @login-success="onLoginSuccess" />

    <!-- My Courses Modal -->
    <Modal v-model="showMyCoursesModal" title="我的课程" size="medium" :show-footer="false">
      <div class="my-courses-content">
        <div v-if="myCourses.length > 0" class="my-courses-list">
          <div v-for="course in myCourses" :key="course.orderNo" class="my-course-card">
            <div class="course-icon-small">{{ course.courseIcon }}</div>
            <div class="course-info-main">
              <h4>{{ course.courseName }}</h4>
              <p>教练：{{ course.coach }} · {{ course.lessons }}</p>
              <div class="course-progress">
                <div class="progress-bar"><div class="progress-fill" :style="{ width: course.progress + '%' }"></div></div>
                <span>{{ course.progress }}%</span>
              </div>
            </div>
            <button class="btn-study" @click="startStudy(course)">开始学习</button>
          </div>
        </div>
        <div v-else class="courses-empty">
          <div class="empty-icon">📚</div>
          <p>暂无已报名课程</p>
        </div>
      </div>
    </Modal>
  </div>
</template>

<script>
import Modal from '../components/Modal.vue'
import Toast from '../components/Toast.vue'
import LoginModal from '../components/LoginModal.vue'
import { isAuthenticated, onSessionExpired } from '../utils/auth'
import { api, isAbortError, isError, ErrorCodes } from '../utils/api'
import { taskStore } from '../utils/taskStore'

export default {
  name: 'Courses',
  components: { Modal, Toast, LoginModal },
  data() {
    return {
      showDetailModal: false,
      showEnrollModal: false,
      showSuccessModal: false,
      showMyCoursesModal: false, // 我的课程弹框
      enrollLoading: false,
      selectedCourse: null,
      enrollCourse: null,
      enrollResult: null,
      showToast: false,
      toastType: 'success',
      toastTitle: '',
      toastMessage: '',
      showLoginModal: false,
      pendingCourse: null,
      // 报名请求中止器：关闭弹框/离开页面时中止，防止旧请求回来串改状态
      enrollAbort: null,
      // 组件是否仍挂载，防止离开后写响应式状态
      alive: true,
      stopSessionListen: null,
      courses: [
        {
          id: 1,
          name: '台球入门基础课',
          icon: '🎯',
          level: '入门',
          duration: '4周',
          lessons: '8课时',
          students: 156,
          maxStudents: 200,
          price: 599,
          originalPrice: 799,
          description: '从零开始学习台球，掌握基本姿势、握杆方法和击球技巧，适合完全没有基础的新手',
          coach: '张明',
          coachTitle: '高级教练',
          coachBio: '10年教学经验，培养学员超过500人，擅长基础教学和纠正动作',
          gradient: 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)',
          outline: ['台球基础知识介绍', '正确的站姿与握杆', '基本击球动作练习', '直线球练习', '简单角度球', '基础走位概念', '实战练习', '结业考核']
        },
        {
          id: 2,
          name: '斯诺克进阶训练',
          icon: '🎱',
          level: '进阶',
          duration: '6周',
          lessons: '12课时',
          students: 89,
          maxStudents: 100,
          price: 1299,
          originalPrice: 1599,
          description: '深入学习斯诺克战术布局，提升走位和防守能力，掌握高级杆法技巧',
          coach: '李强',
          coachTitle: '国家级教练',
          coachBio: '前省队选手，15年执教经验，多次带队获得全国比赛冠军',
          gradient: 'linear-gradient(135deg, #f093fb 0%, #f5576c 100%)',
          outline: ['斯诺克规则深度解析', '高级杆法：低杆与高杆', '塞球技术详解', '走位规划与执行', '防守策略', '清台技巧', '比赛心态调整', '模拟比赛训练']
        },
        {
          id: 3,
          name: '九球高级技巧',
          icon: '🏆',
          level: '高级',
          duration: '8周',
          lessons: '16课时',
          students: 45,
          maxStudents: 45,
          price: 1999,
          originalPrice: 2499,
          description: '掌握高级杆法、塞球技术和复杂局面处理，提升比赛实战能力',
          coach: '王磊',
          coachTitle: '职业选手',
          coachBio: '现役职业选手，全国九球锦标赛前八，擅长实战技巧教学',
          gradient: 'linear-gradient(135deg, #4facfe 0%, #00f2fe 100%)',
          outline: ['九球比赛规则与策略', '开球技巧优化', '组合球与翻袋', '高级塞球应用', '困难球处理', '安全球战术', '关键球心理', '实战对抗训练']
        },
        {
          id: 4,
          name: '比赛心理训练',
          icon: '🧠',
          level: '专业',
          duration: '3周',
          lessons: '6课时',
          students: 30,
          maxStudents: 32,
          price: 999,
          description: '提升比赛心理素质，学习压力管理和专注力训练，突破瓶颈期',
          coach: '赵芳',
          coachTitle: '运动心理师',
          coachBio: '国家认证运动心理咨询师，服务多支省级运动队',
          gradient: 'linear-gradient(135deg, #fa709a 0%, #fee140 100%)',
          outline: ['运动心理学基础', '压力与焦虑管理', '专注力训练方法', '比赛前心理准备', '失误后的心态调整', '建立自信心']
        }
      ]
    }
  },
  computed: {
    /** 我报名的课程任务（进行中），由 taskStore 单一数据源派生，刷新/返回不丢失 */
    courseTasks() {
      // 依赖 taskStore 的响应式版本，报名/取消后自动更新
      void taskStore.version
      return taskStore.getAll().filter(
        t => t.type === 'course' && t.status !== 'cancelled' && t.status !== 'completed'
      )
    },
    /**
     * 我的课程列表：任务记录与课程目录按 id 对齐合并，
     * 课程名/教练/价格等始终取自目录快照，不会被任务数据串改；
     * 学习进度取自独立的进度存储。
     */
    myCourses() {
      return this.courseTasks
        .map(task => {
          const courseId = Number(task.extra?.courseId)
          const course = this.courses.find(c => c.id === courseId)
          if (!course) return null
          return {
            orderNo: task.extra?.orderNo || task.id,
            courseId: course.id,
            courseName: course.name,
            courseIcon: course.icon,
            coach: course.coach,
            lessons: course.lessons,
            price: course.price,
            status: task.status,
            progress: taskStore.getCourseProgress(course.id)
          }
        })
        .filter(Boolean)
    }
  },
  mounted() {
    // 登录失效时：关闭业务弹框并要求重新登录，避免带着失效态继续提交
    this.stopSessionListen = onSessionExpired(() => {
      if (!this.alive) return
      this.resetEnrollState()
      this.showLoginModal = true
      this.showNotification('warning', '登录已失效', '请重新登录后继续操作')
    })
  },
  beforeUnmount() {
    this.alive = false
    // 离开课程页：中止未完成的报名请求
    if (this.enrollAbort) this.enrollAbort.abort()
    if (this.stopSessionListen) this.stopSessionListen()
  },
  methods: {
    /** 当前用户在该课程上的进行中报名记录 */
    activeEnrollment(course) {
      if (!course) return null
      void taskStore.version
      return taskStore.findActiveCourse(course.id)
    },
    isEnrolled(course) {
      return !!this.activeEnrollment(course)
    },
    isFull(course) {
      if (!course) return false
      return this.displayStudents(course) >= course.maxStudents
    },
    remainingSeats(course) {
      return Math.max(0, course.maxStudents - this.displayStudents(course))
    },
    /** 展示报名人数：目录基线 + 当前用户报名占用，取消后自动回落 */
    displayStudents(course) {
      void taskStore.version
      const base = course.students || 0
      return base + (this.activeEnrollment(course) ? 1 : 0)
    },
    enrollButtonText(course) {
      if (this.isEnrolled(course)) return '已报名'
      if (this.isFull(course)) return '名额已满'
      return '立即报名'
    },
    openCourseDetail(course) {
      // 快速切换不同课程时，始终使用本次点击课程的快照
      this.selectedCourse = course
      this.showDetailModal = true
    },
    openEnrollModal(course) {
      // 以点击瞬间的课程做快照，后续请求/展示都引用它，避免共享引用被替换
      const snapshot = { ...course }
      if (this.isEnrolled(snapshot)) {
        this.showNotification('info', '已报名该课程', '可在“我的课程”中查看学习进度')
        return
      }
      if (this.isFull(snapshot)) {
        this.showNotification('warning', '名额已满', '该课程报名人数已达上限')
        return
      }
      if (!isAuthenticated()) {
        this.pendingCourse = snapshot
        this.showLoginModal = true
        return
      }
      this.enrollCourse = snapshot
      this.showDetailModal = false
      this.showEnrollModal = true
    },
    onLoginSuccess() {
      this.showLoginModal = false
      if (this.pendingCourse) {
        this.enrollCourse = { ...this.pendingCourse }
        this.pendingCourse = null
        this.showDetailModal = false
        this.showEnrollModal = true
      }
    },
    resetEnrollState() {
      this.enrollLoading = false
      this.showEnrollModal = false
      if (this.enrollAbort) {
        this.enrollAbort.abort()
        this.enrollAbort = null
      }
    },
    /** 提交过程中关闭弹框（取消支付）：中止请求，绝不允许旧请求回来创建报名 */
    onEnrollCancel() {
      if (this.enrollLoading && this.enrollAbort) {
        this.enrollAbort.abort()
        this.enrollAbort = null
        this.enrollLoading = false
        this.showNotification('info', '已取消报名', '支付未完成，未占用课程名额')
      }
    },
    async confirmEnroll() {
      // 防重复提交：loading 中直接忽略
      if (this.enrollLoading) return
      if (!this.enrollCourse) return
      if (!isAuthenticated()) {
        this.resetEnrollState()
        this.pendingCourse = { ...this.enrollCourse }
        this.showLoginModal = true
        return
      }

      // 提交前再次校验：满员/重复（防止快速操作期间状态已变化）
      if (this.isEnrolled(this.enrollCourse)) {
        this.resetEnrollState()
        this.showNotification('info', '已报名该课程', '请勿重复报名')
        return
      }
      if (this.isFull(this.enrollCourse)) {
        this.resetEnrollState()
        this.showNotification('warning', '名额已满', '该课程报名人数已达上限')
        return
      }

      // 固定本次操作的课程快照与请求通道，快速切换/关闭都不会串到其它课程
      const targetCourse = { ...this.enrollCourse }
      const controller = new AbortController()
      this.enrollAbort = controller
      this.enrollLoading = true

      const result = await api.enrollCourse(
        { courseId: targetCourse.id },
        { signal: controller.signal }
      )

      if (!this.alive) return
      this.enrollAbort = null
      this.enrollLoading = false

      // 主动取消：静默处理，不弹成功、不写本地状态（写入由服务端/API层完成，已中止）
      if (isAbortError(result)) {
        this.showEnrollModal = false
        return
      }

      if (result.success) {
        // 成功数据完全以接口返回为准，不使用本地拼装
        this.enrollResult = result.data
        this.showEnrollModal = false
        this.showSuccessModal = true
        this.showNotification('info', '已添加到任务中心', '您可以在任务中心查看并管理此课程')
        return
      }

      // 失败：弹框保留，允许用户重试或取消
      if (isError(result, ErrorCodes.DUPLICATE)) {
        this.showNotification('warning', '报名失败', result.error)
      } else if (isError(result, ErrorCodes.FULL)) {
        this.showNotification('warning', '名额已满', result.error)
      } else if (isError(result, ErrorCodes.AUTH_EXPIRED)) {
        this.showEnrollModal = false
        this.pendingCourse = targetCourse
        this.showLoginModal = true
        this.showNotification('warning', '登录已失效', '请重新登录后继续操作')
      } else {
        this.showNotification('error', '报名失败', result.error || '请稍后重试')
      }
    },
    goToMyCourses() {
      this.showSuccessModal = false
      this.showMyCoursesModal = true
    },
    startStudy(course) {
      // 学习进度独立按课程 id 累加并持久化，刷新后保留，且不会串到其它课程
      const next = Math.min(100, (course.progress || 0) + 10)
      taskStore.setCourseProgress(course.courseId, next)
      this.showMyCoursesModal = false
      this.showNotification('success', '开始学习', `正在进入"${course.courseName}"课程，当前进度 ${next}%`)
    },
    showNotification(type, title, message) {
      this.toastType = type
      this.toastTitle = title
      this.toastMessage = message
      this.showToast = true
    }
  }
}
</script>

<style scoped>
.courses-page {
  max-width: 1400px;
  margin: 0 auto;
  padding: 0 3rem 4rem;
}

.page-header {
  text-align: center;
  padding: 2rem 0 4rem;
}

.page-tag {
  display: inline-block;
  background: rgba(0, 217, 165, 0.1);
  color: var(--primary);
  padding: 0.5rem 1rem;
  border-radius: 50px;
  font-size: 0.85rem;
  font-weight: 500;
  margin-bottom: 1rem;
}

.page-header h1 {
  font-family: 'Space Grotesk', sans-serif;
  font-size: 3rem;
  font-weight: 700;
  margin-bottom: 0.75rem;
}

.page-header p {
  color: var(--text-secondary);
  font-size: 1.1rem;
}

/* Courses Grid */
.courses-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(320px, 1fr));
  gap: 1.5rem;
}

.course-card {
  position: relative;
  background: var(--bg-card);
  border: 1px solid var(--border);
  border-radius: 24px;
  overflow: hidden;
  cursor: pointer;
  transition: all 0.4s cubic-bezier(0.4, 0, 0.2, 1);
}

.course-card:hover {
  transform: translateY(-8px);
  border-color: rgba(255, 255, 255, 0.15);
}

.card-hover-effect {
  position: absolute;
  inset: 0;
  background: linear-gradient(180deg, transparent 0%, rgba(0, 217, 165, 0.05) 100%);
  opacity: 0;
  transition: opacity 0.4s;
  pointer-events: none;
}

.course-card:hover .card-hover-effect {
  opacity: 1;
}

.card-visual {
  position: relative;
  height: 140px;
  display: flex;
  align-items: center;
  justify-content: center;
  overflow: hidden;
}

.visual-bg {
  position: absolute;
  inset: 0;
  opacity: 0.8;
}

.course-icon {
  font-size: 4rem;
  position: relative;
  z-index: 1;
  filter: drop-shadow(0 4px 8px rgba(0,0,0,0.3));
}

.level-badge {
  position: absolute;
  top: 1rem;
  right: 1rem;
  background: rgba(0, 0, 0, 0.4);
  backdrop-filter: blur(10px);
  padding: 0.4rem 0.8rem;
  border-radius: 20px;
  font-size: 0.75rem;
  font-weight: 600;
  color: #fff;
}

.card-content {
  padding: 1.5rem;
}

.course-meta {
  display: flex;
  gap: 1rem;
  margin-bottom: 1rem;
}

.course-meta span {
  display: flex;
  align-items: center;
  gap: 0.4rem;
  font-size: 0.8rem;
  color: var(--text-secondary);
}

.course-meta svg {
  width: 14px;
  height: 14px;
}

.card-content h3 {
  font-size: 1.2rem;
  font-weight: 600;
  margin-bottom: 0.5rem;
}

.description {
  color: var(--text-secondary);
  font-size: 0.85rem;
  line-height: 1.6;
  margin-bottom: 1.25rem;
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
}

.coach-info {
  display: flex;
  align-items: center;
  gap: 0.75rem;
  padding: 1rem;
  background: rgba(255, 255, 255, 0.03);
  border-radius: 12px;
  margin-bottom: 1.25rem;
}

.coach-avatar {
  width: 40px;
  height: 40px;
  background: var(--gradient-1);
  border-radius: 10px;
  display: flex;
  align-items: center;
  justify-content: center;
  font-weight: 600;
  color: var(--bg-dark);
}

.coach-details {
  display: flex;
  flex-direction: column;
}

.coach-name {
  font-weight: 500;
  font-size: 0.9rem;
}

.coach-title {
  font-size: 0.75rem;
  color: var(--text-secondary);
}

.card-footer {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding-top: 1.25rem;
  border-top: 1px solid var(--border);
}

.price {
  display: flex;
  align-items: baseline;
  gap: 0.5rem;
}

.price .amount {
  font-family: 'Space Grotesk', sans-serif;
  font-size: 1.5rem;
  font-weight: 700;
  color: var(--primary);
}

.price .original {
  font-size: 0.9rem;
  color: var(--text-muted);
  text-decoration: line-through;
}

.btn-enroll {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  background: var(--gradient-1);
  color: var(--bg-dark);
  border: none;
  padding: 0.7rem 1.2rem;
  font-size: 0.85rem;
  font-weight: 600;
  border-radius: 10px;
  cursor: pointer;
  transition: all 0.3s;
}

.btn-enroll:disabled {
  cursor: not-allowed;
  opacity: 0.75;
}

.btn-enroll.enrolled {
  background: rgba(0, 217, 165, 0.15);
  color: var(--primary);
}

.btn-enroll.full {
  background: rgba(255, 255, 255, 0.06);
  color: var(--text-muted);
}

.request-tip {
  font-size: 0.78rem;
  color: #ffc107;
  text-align: center;
  padding-top: 0.25rem;
}

.full-text {
  color: #ff6b6b;
}

.btn-enroll svg {
  width: 16px;
  height: 16px;
  transition: transform 0.3s;
}

.btn-enroll:hover {
  box-shadow: 0 5px 20px var(--primary-glow);
}

.btn-enroll:hover svg {
  transform: translateX(3px);
}

/* Course Detail Modal */
.course-detail {
  margin: -20px -24px;
}

.detail-header {
  height: 160px;
  display: flex;
  align-items: center;
  justify-content: center;
  position: relative;
}

.detail-icon {
  font-size: 5rem;
  filter: drop-shadow(0 4px 12px rgba(0,0,0,0.3));
}

.detail-badge {
  position: absolute;
  top: 1rem;
  left: 1rem;
  background: rgba(0, 0, 0, 0.4);
  backdrop-filter: blur(10px);
  padding: 0.4rem 0.8rem;
  border-radius: 20px;
  font-size: 0.75rem;
  font-weight: 600;
  color: #fff;
}

.detail-content {
  padding: 1.5rem;
}

.detail-content h2 {
  font-family: 'Space Grotesk', sans-serif;
  font-size: 1.5rem;
  font-weight: 700;
  margin-bottom: 0.5rem;
}

.detail-desc {
  color: var(--text-secondary);
  font-size: 0.9rem;
  line-height: 1.6;
  margin-bottom: 1.5rem;
}

.detail-stats {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 1rem;
  margin-bottom: 1.5rem;
}

.detail-stats .stat {
  text-align: center;
  padding: 1rem;
  background: rgba(255, 255, 255, 0.03);
  border-radius: 12px;
}

.stat-value {
  display: block;
  font-family: 'Space Grotesk', sans-serif;
  font-size: 1.25rem;
  font-weight: 700;
  color: var(--primary);
  margin-bottom: 0.25rem;
}

.stat-label {
  font-size: 0.75rem;
  color: var(--text-secondary);
}

.detail-coach {
  display: flex;
  gap: 1rem;
  padding: 1.25rem;
  background: rgba(255, 255, 255, 0.03);
  border-radius: 16px;
  margin-bottom: 1.5rem;
}

.coach-avatar.large {
  width: 56px;
  height: 56px;
  font-size: 1.25rem;
  border-radius: 14px;
  flex-shrink: 0;
}

.detail-coach .coach-info {
  display: flex;
  flex-direction: column;
  padding: 0;
  background: none;
  margin: 0;
}

.detail-coach h4 {
  font-weight: 600;
  margin-bottom: 0.15rem;
}

.detail-coach .title {
  font-size: 0.8rem;
  color: var(--primary);
  margin-bottom: 0.5rem;
}

.detail-coach .bio {
  font-size: 0.8rem;
  color: var(--text-secondary);
  line-height: 1.5;
}

.course-outline {
  margin-bottom: 1.5rem;
}

.course-outline h4 {
  font-size: 1rem;
  font-weight: 600;
  margin-bottom: 1rem;
}

.outline-list {
  display: grid;
  grid-template-columns: repeat(2, 1fr);
  gap: 0.5rem;
}

.outline-item {
  display: flex;
  align-items: center;
  gap: 0.75rem;
  padding: 0.75rem;
  background: rgba(255, 255, 255, 0.03);
  border-radius: 10px;
}

.outline-num {
  font-family: 'Space Grotesk', sans-serif;
  font-size: 0.8rem;
  font-weight: 600;
  color: var(--primary);
}

.outline-text {
  font-size: 0.85rem;
  color: var(--text-secondary);
}

.detail-footer {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding-top: 1.5rem;
  border-top: 1px solid var(--border);
}

.detail-price {
  display: flex;
  align-items: baseline;
  gap: 0.75rem;
}

.detail-price .current {
  font-family: 'Space Grotesk', sans-serif;
  font-size: 2rem;
  font-weight: 700;
  color: var(--primary);
}

.detail-price .original {
  font-size: 1rem;
  color: var(--text-muted);
  text-decoration: line-through;
}

.btn-enroll-large {
  background: var(--gradient-1);
  color: var(--bg-dark);
  border: none;
  padding: 1rem 2rem;
  font-size: 1rem;
  font-weight: 600;
  border-radius: 12px;
  cursor: pointer;
  transition: all 0.3s;
}

.btn-enroll-large:disabled {
  cursor: not-allowed;
  opacity: 0.75;
}

.btn-enroll-large.enrolled {
  background: rgba(0, 217, 165, 0.15);
  color: var(--primary);
}

.btn-enroll-large.full {
  background: rgba(255, 255, 255, 0.06);
  color: var(--text-muted);
}

.btn-enroll-large:not(:disabled):hover {
  transform: scale(1.02);
  box-shadow: 0 8px 30px var(--primary-glow);
}

/* Enroll Info */
.enroll-info, .success-info {
  display: flex;
  flex-direction: column;
  gap: 0.75rem;
  padding: 1rem;
  background: rgba(255, 255, 255, 0.03);
  border-radius: 12px;
  text-align: left;
}

.info-row {
  display: flex;
  justify-content: space-between;
  font-size: 0.9rem;
}

.info-row .label {
  color: var(--text-secondary);
}

.info-row .value {
  font-weight: 500;
}

.info-row.total {
  border-top: 1px solid var(--border);
  padding-top: 0.75rem;
  margin-top: 0.25rem;
}

.info-row .value.price {
  font-family: 'Space Grotesk', sans-serif;
  font-size: 1.25rem;
  color: var(--primary);
}

@media (max-width: 768px) {
  .courses-page {
    padding: 0 1.5rem 3rem;
  }
  
  .page-header h1 {
    font-size: 2rem;
  }
  
  .courses-grid {
    grid-template-columns: 1fr;
  }
  
  .outline-list {
    grid-template-columns: 1fr;
  }
}
</style>


<style scoped>
/* My Courses Modal Styles */
.my-courses-content { margin: -20px -24px; }
.my-courses-list { max-height: 400px; overflow-y: auto; padding: 1rem 1.5rem; }
.my-course-card { display: flex; align-items: center; gap: 1rem; background: rgba(255, 255, 255, 0.03); border-radius: 12px; padding: 1rem; margin-bottom: 0.75rem; }
.course-icon-small { font-size: 2rem; width: 50px; height: 50px; background: var(--bg-card-hover); border-radius: 10px; display: flex; align-items: center; justify-content: center; }
.course-info-main { flex: 1; }
.course-info-main h4 { font-size: 0.95rem; font-weight: 500; margin-bottom: 0.25rem; }
.course-info-main p { font-size: 0.8rem; color: var(--text-secondary); margin-bottom: 0.5rem; }
.course-progress { display: flex; align-items: center; gap: 0.5rem; }
.progress-bar { flex: 1; height: 4px; background: rgba(255, 255, 255, 0.1); border-radius: 2px; overflow: hidden; }
.progress-fill { height: 100%; background: var(--primary); border-radius: 2px; transition: width 0.3s; }
.course-progress span { font-size: 0.75rem; color: var(--text-muted); min-width: 30px; }
.btn-study { background: var(--gradient-1); border: none; color: var(--bg-dark); padding: 0.5rem 1rem; border-radius: 8px; font-size: 0.8rem; font-weight: 600; cursor: pointer; transition: all 0.3s; }
.btn-study:hover { box-shadow: 0 4px 15px var(--primary-glow); }
.courses-empty { padding: 3rem; text-align: center; color: var(--text-muted); }
.courses-empty .empty-icon { font-size: 3rem; margin-bottom: 0.5rem; opacity: 0.5; }
</style>