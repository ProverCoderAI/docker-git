export const trimLeftChar = (value: string, char: string): string => {
  let start = 0
  while (start < value.length && value[start] === char) {
    start += 1
  }
  return value.slice(start)
}

export const trimRightChar = (value: string, char: string): string => {
  let end = value.length
  while (end > 0 && value[end - 1] === char) {
    end -= 1
  }
  return value.slice(0, end)
}
