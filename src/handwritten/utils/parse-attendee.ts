export interface Attendee {
  email: string
  display_name?: string
}

export function parseAttendee(input: string): Attendee {
  const match = input.match(/^(.*?)\s*<(.*?)>$/)
  if (match) {
    const display_name = match[1]!.trim()
    const email = match[2]!.trim()
    return display_name ? { email, display_name } : { email }
  }
  return { email: input.trim() }
}
