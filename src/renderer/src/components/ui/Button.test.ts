import { describe, expect, it } from 'vitest'
import { buttonClass } from './Button'
import { dim } from '../../styles/tokens'
import { CARD_W } from '../image/geometry'

describe('buttonClass', () => {
  it('maps variants and sizes to the DS classes', () => {
    expect(buttonClass({})).toBe('btn')
    expect(buttonClass({ variant: 'primary', size: 'sm' })).toBe('btn btn-primary btn-sm')
    expect(buttonClass({ variant: 'ghost', danger: true })).toBe('btn btn-ghost danger')
    expect(buttonClass({ variant: 'link', className: 'x' })).toBe('link-btn x')
  })
})

describe('generated tokens', () => {
  it('feed the image canvas geometry', () => {
    expect(CARD_W.output).toBe(dim['layout/img-card-output-width'])
    expect(dim['icon-size/nav']).toBe(18)
  })
})
