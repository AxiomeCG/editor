import { expect, test } from 'bun:test'
import { floorNumber, renumberUnitName, repeatedFloorName } from './floor-numbering'

for (const [name, from, to, expected] of [
  ['401', 4, 5, '501'],
  ['Unit 401', 4, 5, 'Unit 501'],
  ['A-401B', 4, 5, 'A-501B'],
  ['901', 9, 10, '1001'],
  ['1001', 10, 9, '901'],
  ['0401', 4, 5, '0501'],
  ['401', 3, 4, '401'],
  ['Penthouse', 4, 5, 'Penthouse'],
  ['Type 2 / 401', 4, 5, 'Type 2 / 401'],
  ['41', 4, 5, '41'],
  ['401', 4, -1, '401'],
] as const)
  test(`number ${name} from ${from} to ${to}`, () =>
    expect(renumberUnitName(name, from, to)).toBe(expected))

test('displayed floor convention can differ from the stack ordinal', () => {
  const level = { level: 3, name: 'Étage 4' }
  expect(floorNumber(level)).toBe(4)
  expect(repeatedFloorName(level, 4)).toBe('Étage 5')
})
