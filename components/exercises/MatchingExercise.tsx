'use client'

import React, { useState, useEffect, useRef } from 'react'
import { shuffleArray } from '@/lib/utils/shuffle'
import { RotateCcw } from 'lucide-react'

interface VocabItem {
  id: string
  hanzi: string
  pinyin: string
  vietnamese: string
}

interface MatchingExerciseProps {
  vocabs: VocabItem[]
  matchType: 'hanzi_pinyin' | 'hanzi_viet'
  onComplete: (score: number) => void
}

interface Connection {
  leftId: string
  rightId: string
  isCorrect: boolean
  isError?: boolean
}

export default function MatchingExercise({
  vocabs,
  matchType,
  onComplete
}: MatchingExerciseProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const elementRefs = useRef<{ [key: string]: HTMLButtonElement | null }>({})

  const [leftItems, setLeftItems] = useState<{ id: string; text: string }[]>([])
  const [rightItems, setRightItems] = useState<{ id: string; text: string }[]>([])

  const [selectedLeft, setSelectedLeft] = useState<string | null>(null)
  const [selectedRight, setSelectedRight] = useState<string | null>(null)

  const [connections, setConnections] = useState<Connection[]>([])
  const [matchedIds, setMatchedIds] = useState<Set<string>>(new Set())
  // Matched pairs first play the success pulse, then fade out (disappearingIds),
  // then are fully removed from the board (removedIds) so the screen doesn't stay
  // cluttered with dimmed-out pairs as a round progresses.
  const [disappearingIds, setDisappearingIds] = useState<Set<string>>(new Set())
  const [removedIds, setRemovedIds] = useState<Set<string>>(new Set())
  const [shakeId, setShakeId] = useState<string | null>(null)
  // Guards against onComplete firing more than once for the same round.
  const completionFiredRef = useRef(false)
  // `onComplete` is a fresh function reference on every parent re-render (it isn't
  // memoized). Keeping it in a ref — instead of the completion effect's dependency
  // array — means that re-render alone can't re-run the effect. Without this, when a
  // round finishes and the parent re-renders with new `vocabs` AND a new `onComplete`
  // in the same commit, both this effect and the vocabs-reset effect below fire in the
  // same pass; the reset effect (declared first) clears `completionFiredRef` before
  // this effect re-reads the *stale* matchedIds/leftItems (still showing the just-
  // finished round as complete), causing onComplete to fire a second time immediately
  // and silently skip the next round of words.
  const onCompleteRef = useRef(onComplete)
  useEffect(() => {
    onCompleteRef.current = onComplete
  }, [onComplete])

  // Track coordinates for rendering lines
  const [lines, setLines] = useState<{
    id: string
    x1: number
    y1: number
    x2: number
    y2: number
    isCorrect: boolean
    isError: boolean
  }[]>([])

  // Initialize columns
  useEffect(() => {
    if (!vocabs || vocabs.length === 0) return

    const left = vocabs.map(v => {
      const text = v.hanzi
      return { id: v.id, text }
    })

    const right = vocabs.map(v => {
      const text = matchType === 'hanzi_pinyin' ? v.pinyin : v.vietnamese
      return { id: v.id, text }
    })

    setLeftItems(shuffleArray(left))
    setRightItems(shuffleArray(right))
    setConnections([])
    setMatchedIds(new Set())
    setDisappearingIds(new Set())
    setRemovedIds(new Set())
    setSelectedLeft(null)
    setSelectedRight(null)
    setLines([])
    completionFiredRef.current = false
  }, [vocabs, matchType])

  // Recalculate line coordinates whenever connections change or on resize
  const updateLines = () => {
    if (!containerRef.current) return
    const containerRect = containerRef.current.getBoundingClientRect()

    const newLines = connections.map((conn, idx) => {
      const leftEl = elementRefs.current[`left-${conn.leftId}`]
      const rightEl = elementRefs.current[`right-${conn.rightId}`]

      if (!leftEl || !rightEl) return null

      const leftRect = leftEl.getBoundingClientRect()
      const rightRect = rightEl.getBoundingClientRect()

      // Calculate relative coordinates
      const x1 = leftRect.right - containerRect.left
      const y1 = leftRect.top + leftRect.height / 2 - containerRect.top
      const x2 = rightRect.left - containerRect.left
      const y2 = rightRect.top + rightRect.height / 2 - containerRect.top

      return {
        id: `${conn.leftId}-${conn.rightId}-${idx}`,
        x1,
        y1,
        x2,
        y2,
        isCorrect: conn.isCorrect,
        isError: !!conn.isError
      }
    }).filter(Boolean) as any[]

    setLines(newLines)
  }

  // Monitor layout changes
  useEffect(() => {
    updateLines()
    window.addEventListener('resize', updateLines)
    return () => window.removeEventListener('resize', updateLines)
  }, [connections, leftItems, rightItems, removedIds])

  // Check matching logic
  useEffect(() => {
    if (selectedLeft && selectedRight) {
      const isMatch = selectedLeft === selectedRight

      if (isMatch) {
        // Correct match
        const newConnection: Connection = {
          leftId: selectedLeft,
          rightId: selectedRight,
          isCorrect: true
        }

        setConnections(prev => [...prev, newConnection])
        setMatchedIds(prev => {
          const next = new Set(prev)
          next.add(selectedLeft)
          return next
        })

        setSelectedLeft(null)
        setSelectedRight(null)

        // Let the success pulse play, then fade out, then remove the pair entirely
        // so matched items don't clutter the board for the rest of the round.
        const matchedId = selectedLeft
        setTimeout(() => {
          setDisappearingIds(prev => new Set(prev).add(matchedId))
        }, 400)
        setTimeout(() => {
          setRemovedIds(prev => new Set(prev).add(matchedId))
        }, 700)
      } else {
        // Incorrect match
        const tempConnection: Connection = {
          leftId: selectedLeft,
          rightId: selectedRight,
          isCorrect: false,
          isError: true
        }

        setConnections(prev => [...prev, tempConnection])
        setShakeId(selectedLeft) // trigger shake animation

        // Play error state, then clear
        setTimeout(() => {
          setConnections(prev => prev.filter(c => c !== tempConnection))
          setSelectedLeft(null)
          setSelectedRight(null)
          setShakeId(null)
        }, 1000)
      }
    }
  }, [selectedLeft, selectedRight])

  // Handle completion trigger. Deliberately excludes `onComplete` from the deps (see
  // onCompleteRef above) so this only re-runs on actual match progress, not whenever
  // the parent hands us a new callback reference.
  useEffect(() => {
    if (leftItems.length > 0 && matchedIds.size === leftItems.length && !completionFiredRef.current) {
      completionFiredRef.current = true
      // Calculate score (simple 100 base)
      setTimeout(() => {
        onCompleteRef.current(100)
      }, 800)
    }
  }, [matchedIds, leftItems])

  const handleLeftClick = (id: string) => {
    if (matchedIds.has(id) || selectedLeft === id) return
    setSelectedLeft(id)
  }

  const handleRightClick = (id: string) => {
    if (matchedIds.has(id) || selectedRight === id) return
    setSelectedRight(id)
  }

  const handleReset = () => {
    setConnections([])
    setMatchedIds(new Set())
    setDisappearingIds(new Set())
    setRemovedIds(new Set())
    setSelectedLeft(null)
    setSelectedRight(null)
    setLines([])
    setLeftItems(shuffleArray(leftItems))
    setRightItems(shuffleArray(rightItems))
  }

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center bg-slate-50/80 p-3 rounded-2xl border border-slate-100 shadow-sm">
        <span className="font-extrabold text-sm text-slate-500">
          TIẾN ĐỘ: {matchedIds.size} / {leftItems.length}
        </span>
        <button 
          onClick={handleReset}
          className="cartoon-btn cartoon-btn-secondary px-3 py-1.5 text-xs flex items-center gap-1"
        >
          <RotateCcw className="w-3.5 h-3.5" /> Làm lại
        </button>
      </div>

      <div 
        ref={containerRef} 
        className="relative grid grid-cols-2 gap-x-16 gap-y-3 min-h-[300px] p-4 bg-white border border-slate-100 rounded-3xl overflow-hidden shadow-xl shadow-slate-100/40"
      >
        {/* SVG Drawing Layer */}
        <svg className="absolute inset-0 w-full h-full pointer-events-none z-10">
          {lines.map((line) => (
            <line
              key={line.id}
              x1={line.x1}
              y1={line.y1}
              x2={line.x2}
              y2={line.y2}
              stroke={line.isCorrect ? '#10b981' : line.isError ? '#ef4444' : '#3b82f6'}
              strokeWidth="4"
              strokeDasharray={line.isCorrect ? 'none' : '6, 6'}
              className={`transition-all duration-300 ${line.isCorrect ? 'animate-pulse' : ''}`}
            />
          ))}
          {/* Active temporary line drawing */}
          {selectedLeft && (
            // We can draw a dotted indicator from left to right if they hover, or keep it simple
            null
          )}
        </svg>

        {/* LEFT COLUMN */}
        <div className="flex flex-col gap-3 z-20 mx-auto">
          {leftItems.filter(item => !removedIds.has(item.id)).map((item) => {
            const isSelected = selectedLeft === item.id
            const isMatched = matchedIds.has(item.id)
            const isDisappearing = disappearingIds.has(item.id)
            const isShaking = shakeId === item.id

            return (
              <button
                key={`left-${item.id}`}
                ref={el => { elementRefs.current[`left-${item.id}`] = el }}
                onClick={() => handleLeftClick(item.id)}
                disabled={isMatched}
                className={`py-3 px-4 text-center rounded-2xl border font-extrabold md:text-4xl text-md transition-all duration-300 md:w-[500px] ${
                  isDisappearing
                    ? 'opacity-0 scale-75'
                    : isMatched
                    ? 'bg-emerald-50 border-emerald-200 text-emerald-600 animate-pulse'
                    : isSelected
                    ? 'bg-gradient-to-r from-indigo-600 to-blue-600 text-white border-transparent shadow-lg shadow-indigo-100 scale-105'
                    : 'bg-white text-slate-800 border-slate-200 hover:bg-slate-50 hover:border-slate-300 shadow-sm'
                } ${isShaking ? 'animate-shake bg-red-50 border-red-200 text-red-600' : ''}`}
              >
                <span className="font-chinese text-xl md:text-4xl">{item.text}</span>
              </button>
            )
          })}
        </div>

        {/* RIGHT COLUMN */}
        <div className="flex flex-col gap-3 z-20 mx-auto">
          {rightItems.filter(item => !removedIds.has(item.id)).map((item) => {
            const isSelected = selectedRight === item.id
            const isMatched = matchedIds.has(item.id)
            const isDisappearing = disappearingIds.has(item.id)

            return (
              <button
                key={`right-${item.id}`}
                ref={el => { elementRefs.current[`right-${item.id}`] = el }}
                onClick={() => handleRightClick(item.id)}
                disabled={isMatched}
                className={`py-3 px-4 text-center rounded-2xl border font-extrabold md:text-4xl text-md transition-all duration-300 md:w-[500px] ${
                  isDisappearing
                    ? 'opacity-0 scale-75'
                    : isMatched
                    ? 'bg-emerald-50 border-emerald-200 text-emerald-600 animate-pulse'
                    : isSelected
                    ? 'bg-gradient-to-r from-indigo-600 to-blue-600 text-white border-transparent shadow-lg shadow-indigo-100 scale-105'
                    : 'bg-white text-slate-800 border-slate-200 hover:bg-slate-50 hover:border-slate-300 shadow-sm'
                }`}
              >
                <span className="font-chinese text-xl md:text-4xl">{item.text}</span>
              </button>
            )
          })}
        </div>
      </div>
    </div>
  )
}
