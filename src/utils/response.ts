export function apiResponse ({
  data = null,
  message = 'OK',
  success = true,
  executionTime = null,
  pagination = null,
}: {
  data?: any
  message?: string
  success?: boolean
  executionTime?: string | null
  pagination?: any
}) {
  return {
    metadata: {
      success,
      message,
      timestamp: new Date().toISOString().replace('T', ' ').substring(0, 19),
      executionTime,
    },
    data,
    ...(pagination ? { pagination } : {}),
  }
}
