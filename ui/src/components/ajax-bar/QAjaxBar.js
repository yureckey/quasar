import { h, ref, computed, onMounted, onBeforeUnmount, getCurrentInstance } from 'vue'

import { createComponent } from '../../utils/private/create.js'
import { between } from '../../utils/format.js'

const
  xhr = __QUASAR_SSR_SERVER__ ? null : XMLHttpRequest,
  open = __QUASAR_SSR_SERVER__ ? null : xhr.prototype.open,
  positionValues = [ 'top', 'right', 'bottom', 'left' ]

let stack = []
let highjackCount = 0

function translate ({ p, pos, active, horiz, reverse, dir }) {
  let x = 1, y = 1

  if (horiz === true) {
    if (reverse === true) { x = -1 }
    if (pos === 'bottom') { y = -1 }
    return { transform: `translate3d(${ x * (p - 100) }%,${ active ? 0 : y * -200 }%,0)` }
  }

  if (reverse === true) { y = -1 }
  if (pos === 'right') { x = -1 }
  return { transform: `translate3d(${ active ? 0 : dir * x * -200 }%,${ y * (p - 100) }%,0)` }
}

function inc (p, amount) {
  if (typeof amount !== 'number') {
    if (p < 25) {
      amount = Math.random() * 3 + 3
    }
    else if (p < 65) {
      amount = Math.random() * 3
    }
    else if (p < 85) {
      amount = Math.random() * 2
    }
    else if (p < 99) {
      amount = 0.6
    }
    else {
      amount = 0
    }
  }
  return between(p + amount, 0, 100)
}

function highjackAjax (stackEntry) {
  highjackCount++

  stack.push(stackEntry)

  if (highjackCount > 1) { return }

  xhr.prototype.open = function (_, url) {
    const stopStack = []

    const loadStart = () => {
      stack.forEach(entry => {
        if (
          entry.hijackFilter.value === null
          || (entry.hijackFilter.value(url) === true)
        ) {
          entry.start()
          stopStack.push(entry.stop)
        }
      })
    }

    const loadEnd = () => {
      stopStack.forEach(stop => { stop() })
    }

    this.addEventListener('loadstart', loadStart, { once: true })
    this.addEventListener('loadend', loadEnd, { once: true })

    open.apply(this, arguments)
  }
}

function restoreAjax (start) {
  stack = stack.filter(entry => entry.start !== start)

  highjackCount = Math.max(0, highjackCount - 1)
  if (highjackCount === 0) {
    xhr.prototype.open = open
  }
}

export default createComponent({
  name: 'QAjaxBar',

  props: {
    position: {
      type: String,
      default: 'top',
      validator: val => positionValues.includes(val)
    },

    size: {
      type: String,
      default: '2px'
    },

    color: String,
    skipHijack: Boolean,
    reverse: Boolean,

    hijackFilter: Function
  },

  emits: [ 'start', 'stop' ],

  setup (props, { emit }) {
    const { proxy } = getCurrentInstance()

    const progress = ref(0)
    const onScreen = ref(false)
    const animate = ref(true)

    let calls = 0, timer, speed

    const classes = computed(() =>
      `q-loading-bar q-loading-bar--${ props.position }`
      + (props.color !== void 0 ? ` bg-${ props.color }` : '')
      + (animate.value === true ? '' : ' no-transition')
    )

    const horizontal = computed(() => props.position === 'top' || props.position === 'bottom')
    const sizeProp = computed(() => (horizontal.value === true ? 'height' : 'width'))

    const style = computed(() => {
      const active = onScreen.value

      const obj = translate({
        p: progress.value,
        pos: props.position,
        active,
        horiz: horizontal.value,
        reverse: proxy.$q.lang.rtl === true && [ 'top', 'bottom' ].includes(props.position)
          ? props.reverse === false
          : props.reverse,
        dir: proxy.$q.lang.rtl === true ? -1 : 1
      })

      obj[ sizeProp.value ] = props.size
      obj.opacity = active ? 1 : 0

      return obj
    })

    const attributes = computed(() => (
      onScreen.value === true
        ? {
            role: 'progressbar',
            'aria-valuemin': 0,
            'aria-valuemax': 100,
            'aria-valuenow': progress.value
          }
        : { 'aria-hidden': 'true' }
    ))

    function start (newSpeed = 300) {
      const oldSpeed = speed
      speed = Math.max(0, newSpeed) || 0

      calls++

      if (calls > 1) {
        if (oldSpeed === 0 && newSpeed > 0) {
          planNextStep()
        }
        else if (oldSpeed > 0 && newSpeed <= 0) {
          clearTimeout(timer)
        }
        return
      }

      clearTimeout(timer)
      emit('start')

      progress.value = 0

      if (onScreen.value === true) { return }

      onScreen.value = true
      animate.value = false
      timer = setTimeout(() => {
        animate.value = true
        newSpeed > 0 && planNextStep()
      }, 100)
    }

    function increment (amount) {
      if (calls > 0) {
        progress.value = inc(progress.value, amount)
      }
    }

    function stop () {
      calls = Math.max(0, calls - 1)
      if (calls > 0) { return }

      clearTimeout(timer)
      emit('stop')

      const end = () => {
        animate.value = true
        progress.value = 100
        timer = setTimeout(() => {
          onScreen.value = false
        }, 1000)
      }

      if (progress.value === 0) {
        timer = setTimeout(end, 1)
      }
      else {
        end()
      }
    }

    function planNextStep () {
      if (progress.value < 100) {
        timer = setTimeout(() => {
          increment()
          planNextStep()
        }, speed)
      }
    }

    let hijacked

    onMounted(() => {
      if (props.skipHijack !== true) {
        hijacked = true
        highjackAjax({
          start,
          stop,
          hijackFilter: computed(() => props.hijackFilter || null)
        })
      }
    })

    onBeforeUnmount(() => {
      clearTimeout(timer)
      hijacked === true && restoreAjax(start)
    })

    // expose public methods
    Object.assign(proxy, { start, stop, increment })

    return () => h('div', {
      class: classes.value,
      style: style.value,
      ...attributes.value
    })
  }
})
