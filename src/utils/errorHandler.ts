/**
 * Utilidades reutilizables para manejo de errores
 * src/utils/errorHandler.ts
 */

export interface ValidationErrorDetail {
  field: string
  message: string
  count?: number
  examples?: string[]
}

export interface ErrorResponse {
  success: false
  error: string
  error_type: 'validation' | 'business' | 'system'
  details?: ValidationErrorDetail[]
  operation?: string
  execution_time?: string
  request_id?: string
}

/**
 * Genera un ID único para la request
 */
export function generateRequestId (operation: string): string {
  return `${operation}-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`
}

/**
 * Determina el tipo de error basado en el mensaje
 */
export function categorizeError (message: string): 'validation' | 'business' | 'system' {
  const validationKeywords = [
    'missing', 'required', 'invalid', 'cannot be empty',
    'must be', 'validation failed', 'exceed'
  ]

  const systemKeywords = [
    'connection', 'timeout', 'ECONNREFUSED', 'database',
    'network', 'internal server'
  ]

  const lowerMessage = message.toLowerCase()

  if (validationKeywords.some(keyword => lowerMessage.includes(keyword))) {
    return 'validation'
  }

  if (systemKeywords.some(keyword => lowerMessage.includes(keyword))) {
    return 'system'
  }

  return 'business'
}

/**
 * Extrae detalles específicos de errores de validación
 */
export function extractValidationDetails (message: string): ValidationErrorDetail[] {
  const details: ValidationErrorDetail[] = []

  // Pattern para "X items are missing Y"
  const missingPattern = /(\d+) (\w+) are missing (\w+)/
  const match = message.match(missingPattern)

  if (match) {
    const [, count, itemType, field] = match
    details.push({
      field: `${itemType}[].${field}`,
      message: `${count} ${itemType} are missing the required ${field} field`,
      count: parseInt(count)
    })
  }

  // Pattern para "exceeds limit"
  const exceedPattern = /exceed ([\d,]+)/
  const exceedMatch = message.match(exceedPattern)

  if (exceedMatch) {
    details.push({
      field: 'batch_size',
      message: `Batch size cannot exceed ${exceedMatch[1]}`
    })
  }

  return details
}

/**
 * Log estructurado de errores
 */
export function logError (
  operation: string,
  requestId: string,
  error: unknown,
  executionTime: string,
  additionalContext?: Record<string, any>
): void {
  const errorInfo = {
    operation,
    request_id: requestId,
    error: error instanceof Error ? error.message : 'Unknown error',
    stack: error instanceof Error ? error.stack : undefined,
    execution_time: executionTime,
    timestamp: new Date().toISOString(),
    ...additionalContext
  }

  console.error(`❌ Error in ${operation} [${requestId}]:`, errorInfo)

  // Si tienes un servicio de logging externo (como CloudWatch, DataDog, etc.)
  // puedes agregarlo aquí
  // externalLogger.error(errorInfo)
}

/**
 * Sanitiza datos sensibles antes del logging
 */
export function sanitizeForLogging (data: any): any {
  if (!data || typeof data !== 'object') return data

  const sensitiveFields = ['password', 'token', 'secret', 'key', 'authorization']
  const sanitized = { ...data }

  for (const field of sensitiveFields) {
    if (sanitized[field]) {
      sanitized[field] = '[REDACTED]'
    }
  }

  return sanitized
}
