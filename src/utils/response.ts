import { ErrorResponse } from './errorHandler'

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

/**
 * Respuesta estandarizada para errores
 */
export function errorResponse (
  error: string,
  errorType: 'validation' | 'business' | 'system' = 'system',
  details?: any,
  statusCode: number = 500
): Response {
  const response: ErrorResponse = {
    success: false,
    error,
    error_type: errorType,
    details,
    request_id: `error-${Date.now()}`
  }

  return Response.json(response, { status: statusCode })
}

/**
 * Respuesta para errores de validación (400)
 */
export function validationErrorResponse (
  error: string,
  details?: any
): Response {
  return errorResponse(error, 'validation', details, 400)
}

/**
 * Respuesta para errores del sistema (500)
 */
export function systemErrorResponse (
  error: string,
  details?: any
): Response {
  return errorResponse(error, 'system', details, 500)
}

/**
 * Respuesta para errores de negocio (422)
 */
export function businessErrorResponse (
  error: string,
  details?: any
): Response {
  return errorResponse(error, 'business', details, 422)
}
