export const error_response_schema_400 = {
  type: 'object',
  properties: {
    error: { type: 'string' },
    message: { type: 'string' },
    validation: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          instancePath: { type: 'string' },
          schemaPath: { type: 'string' },
          keyword: { type: 'string' },
          params: { type: 'object' },
          message: { type: 'string' }
        }
      }
    }
  }
}; 

export const error_response_schema_500 = {
  type: 'object',
  properties: { error: { type: 'string' }, message: { type: 'string' } }
}

export const error_response_schema_404 = {
  type: 'object',
  properties: { error: { type: 'string' }, message: { type: 'string' } }
}

export const error_response_schema_409 = {
  type: 'object',
  properties: { error: { type: 'string' }, message: { type: 'string' } }
}
export const error_response_schema_401 = {
  type: 'object',
  properties: { error: { type: 'string' }, message: { type: 'string' } }
}