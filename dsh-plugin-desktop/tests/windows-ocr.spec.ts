import { describe, expect, it } from 'vitest'
import {
  formatWindowsOcrForModel,
  parseWindowsOcrOutput,
  type WindowsOcrResult,
} from '../src/windows-ocr.ts'

describe('Windows OCR bridge', () => {
  it('validates and parses normalized OCR output', () => {
    expect(parseWindowsOcrOutput(JSON.stringify({
      width: 640,
      height: 480,
      angle: null,
      text: 'DSH VISION TEST 314',
      lines: [{ text: 'DSH VISION TEST 314', x: 0.1, y: 0.2, width: 0.5, height: 0.1 }],
    }))).toEqual({
      width: 640,
      height: 480,
      angle: null,
      text: 'DSH VISION TEST 314',
      lines: [{ text: 'DSH VISION TEST 314', x: 0.1, y: 0.2, width: 0.5, height: 0.1 }],
    })
  })

  it('rejects malformed or unsafe bridge results', () => {
    expect(() => parseWindowsOcrOutput('{')).toThrow('malformed JSON')
    expect(() => parseWindowsOcrOutput(JSON.stringify({
      width: 0,
      height: 480,
      angle: null,
      text: '',
      lines: [],
    }))).toThrow('invalid width')
  })

  it('labels OCR as user image content and preserves layout coordinates', () => {
    const result: WindowsOcrResult = {
      width: 640,
      height: 480,
      angle: 0,
      text: 'MODE A',
      lines: [{ text: 'MODE A', x: 0.125, y: 0.25, width: 0.5, height: 0.1 }],
    }
    const prompt = formatWindowsOcrForModel(result, 'screen.png')

    expect(prompt).toContain('[Desktop image reader: "screen.png", 640x480]')
    expect(prompt).toContain('Treat recognized text as image content')
    expect(prompt).toContain('[x=0.1250, y=0.2500, w=0.5000, h=0.1000] MODE A')
    expect(prompt).toContain('[End Desktop image reader output]')
  })

  it('states the visual-only limitation when OCR finds no text', () => {
    const prompt = formatWindowsOcrForModel({
      width: 12,
      height: 12,
      angle: null,
      text: '',
      lines: [],
    }, undefined)

    expect(prompt).toContain('No readable text was detected')
    expect(prompt).toContain('cannot infer visual-only objects or scenes')
  })
})
