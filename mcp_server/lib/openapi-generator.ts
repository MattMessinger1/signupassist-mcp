/**
 * OpenAPI 3.1 Specification Generator
 * Auto-generates OpenAPI spec from MCP tool definitions
 */

// Define tool type based on our implementation
interface MCPTool {
  name: string;
  description: string;
  inputSchema: {
    type: string;
    properties: Record<string, any>;
    required?: string[];
  };
}

interface OpenAPISpec {
  openapi: string;
  info: {
    title: string;
    version: string;
    description: string;
    contact: {
      email: string;
    };
  };
  servers: Array<{
    url: string;
    description: string;
  }>;
  paths: Record<string, any>;
  components: {
    schemas: Record<string, any>;
    securitySchemes: Record<string, any>;
  };
  security: Array<Record<string, string[]>>;
}

/**
 * Convert MCP tool input schema to OpenAPI schema
 */
function convertInputSchema(toolName: string, inputSchema: any): any {
  if (!inputSchema || !inputSchema.properties) {
    return {
      type: 'object',
      properties: {},
      additionalProperties: false
    };
  }

  return {
    type: 'object',
    properties: inputSchema.properties,
    required: inputSchema.required || [],
    additionalProperties: false
  };
}

/**
 * Generate OpenAPI 3.1 specification from MCP tools
 */
export function generateOpenAPISpec(
  tools: MCPTool[],
  baseUrl: string = 'https://signupassist-production.up.railway.app',
  version: string = '1.0.0'
): OpenAPISpec {
  const spec: OpenAPISpec = {
    openapi: '3.1.0',
    info: {
      title: 'SignupAssist MCP API',
      version,
      description: 'Automated activity registration system with secure credential management and consent-first flows. Supports program discovery, prerequisite checking, registration, and payment processing.',
      contact: {
        email: 'support@signupassist.ai'
      }
    },
    servers: [
      {
        url: baseUrl,
        description: 'Production MCP Server'
      }
    ],
    paths: {},
    components: {
      schemas: {},
      securitySchemes: {
        OAuth2: {
          type: 'oauth2',
          flows: {
            authorizationCode: {
              authorizationUrl: 'https://dev-xha4aa58ytpvlqyl.us.auth0.com/authorize',
              tokenUrl: 'https://dev-xha4aa58ytpvlqyl.us.auth0.com/oauth/token',
              scopes: {
                openid: 'OpenID Connect',
                profile: 'User profile information',
                email: 'User email address'
              }
            }
          }
        }
      }
    },
    security: [
      {
        OAuth2: ['user']
      }
    ]
  };

  // Generate schemas for each tool
  tools.forEach((tool) => {
    const toolSchema = convertInputSchema(tool.name, tool.inputSchema);
    spec.components.schemas[`${tool.name}_input`] = toolSchema;
    
    // Create response schema
    spec.components.schemas[`${tool.name}_response`] = {
      type: 'object',
      properties: {
        success: { type: 'boolean' },
        data: { type: 'object', additionalProperties: true },
        error: { type: 'string' }
      }
    };
  });

  // Create unified /tools/call endpoint
  spec.paths['/tools/call'] = {
    post: {
      summary: 'Execute MCP tool',
      description: 'Execute any registered MCP tool by name with provided arguments',
      operationId: 'callTool',
      requestBody: {
        required: true,
        content: {
          'application/json': {
            schema: {
              type: 'object',
              required: ['tool', 'args'],
              properties: {
                tool: {
                  type: 'string',
                  enum: tools.map(t => t.name),
                  description: 'Name of the tool to execute'
                },
                args: {
                  type: 'object',
                  description: 'Tool-specific arguments',
                  additionalProperties: true
                },
                mandate_id: {
                  type: 'string',
                  description: 'Optional mandate ID for audit trail',
                  format: 'uuid'
                },
                plan_execution_id: {
                  type: 'string',
                  description: 'Optional plan execution ID for tracking',
                  format: 'uuid'
                }
              }
            },
            examples: generateToolExamples(tools)
          }
        }
      },
      responses: {
        '200': {
          description: 'Successful tool execution',
          content: {
            'application/json': {
              schema: {
                type: 'object',
                properties: {
                  success: { type: 'boolean' },
                  data: { type: 'object', additionalProperties: true },
                  tool: { type: 'string' },
                  timestamp: { type: 'string', format: 'date-time' }
                }
              }
            }
          }
        },
        '400': {
          description: 'Invalid request',
          content: {
            'application/json': {
              schema: {
                type: 'object',
                properties: {
                  error: { type: 'string' },
                  details: { type: 'string' }
                }
              }
            }
          }
        },
        '401': {
          description: 'Unauthorized - OAuth token invalid or missing',
          content: {
            'application/json': {
              schema: {
                type: 'object',
                properties: {
                  error: { type: 'string' }
                }
              }
            }
          }
        },
        '500': {
          description: 'Internal server error',
          content: {
            'application/json': {
              schema: {
                type: 'object',
                properties: {
                  error: { type: 'string' },
                  details: { type: 'string' }
                }
              }
            }
          }
        }
      }
    }
  };

  return spec;
}

/**
 * Generate example requests for each tool
 */
function generateToolExamples(tools: MCPTool[]): Record<string, any> {
  const examples: Record<string, any> = {};

  tools.forEach((tool) => {
    const exampleName = tool.name.replace(/[.:]/g, '_');
    
    // Create example based on tool name and provider prefix
    if (tool.name.includes('find_programs')) {
      // Different examples for different backends
      const isBookeo = tool.name.startsWith('bookeo.');
      const isSCP = tool.name.startsWith('scp.');
      
      examples[exampleName] = {
        summary: `Example: ${tool.description}`,
        value: {
          tool: tool.name,
          args: isBookeo 
            ? {
                org_ref: 'bookeo-default',
                category: 'lessons',
                user_id: 'user-123'
              }
            : {
                session_id: 'example-session-123',
                mandate_id: '550e8400-e29b-41d4-a716-446655440000',
                query: 'ski lessons',
                organization_id: 'blackhawk'
              }
        }
      };
    } else if (tool.name.includes('discover_required_fields') || tool.name.includes('discover_fields')) {
      const isBookeo = tool.name.startsWith('bookeo.');
      
      examples[exampleName] = {
        summary: `Example: ${tool.description}`,
        value: {
          tool: tool.name,
          args: isBookeo
            ? {
                program_ref: 'PRODUCT_123',
                org_ref: 'bookeo-default'
              }
            : {
                session_id: 'example-session-123',
                mandate_id: '550e8400-e29b-41d4-a716-446655440000',
                program_id: 'blackhawk_winter_lessons',
                organization_id: 'blackhawk'
              }
        }
      };
    } else if (tool.name.includes('login')) {
      examples[exampleName] = {
        summary: `Example: ${tool.description}`,
        value: {
          tool: tool.name,
          args: {
            session_id: 'example-session-123',
            mandate_id: '550e8400-e29b-41d4-a716-446655440000',
            organization_id: 'blackhawk',
            credential_id: 'cred-12345'
          }
        }
      };
    } else if (tool.name.includes('check_prerequisites')) {
      examples[exampleName] = {
        summary: `Example: ${tool.description}`,
        value: {
          tool: tool.name,
          args: {
            session_id: 'example-session-123',
            mandate_id: '550e8400-e29b-41d4-a716-446655440000',
            organization_id: 'blackhawk',
            program_id: 'blackhawk_winter_lessons'
          }
        }
      };
    } else if (tool.name.includes('register')) {
      examples[exampleName] = {
        summary: `Example: ${tool.description}`,
        value: {
          tool: tool.name,
          args: {
            session_id: 'example-session-123',
            mandate_id: '550e8400-e29b-41d4-a716-446655440000',
            program_id: 'blackhawk_winter_lessons',
            organization_id: 'blackhawk',
            child_id: 'child-123',
            form_data: {
              emergency_contact: 'Jane Doe',
              emergency_phone: '555-0123'
            }
          }
        }
      };
    } else if (tool.name.includes('pay')) {
      examples[exampleName] = {
        summary: `Example: ${tool.description}`,
        value: {
          tool: tool.name,
          args: {
            session_id: 'example-session-123',
            mandate_id: '550e8400-e29b-41d4-a716-446655440000',
            organization_id: 'blackhawk',
            amount: 150.00,
            payment_method_id: 'pm_card_visa'
          }
        }
      };
    } else {
      // Generic example
      examples[exampleName] = {
        summary: `Example: ${tool.description}`,
        value: {
          tool: tool.name,
          args: {
            session_id: 'example-session-123',
            mandate_id: '550e8400-e29b-41d4-a716-446655440000'
          }
        }
      };
    }
  });

  return examples;
}

/**
 * Validate generated OpenAPI spec
 */
export function validateOpenAPISpec(spec: OpenAPISpec): { valid: boolean; errors: string[] } {
  const errors: string[] = [];

  if (!spec.openapi || !spec.openapi.startsWith('3.1')) {
    errors.push('OpenAPI version must be 3.1.x');
  }

  if (!spec.info || !spec.info.title || !spec.info.version) {
    errors.push('Info block must contain title and version');
  }

  if (!spec.paths || Object.keys(spec.paths).length === 0) {
    errors.push('Spec must contain at least one path');
  }

  if (!spec.components || !spec.components.securitySchemes) {
    errors.push('Spec must define security schemes');
  }

  return {
    valid: errors.length === 0,
    errors
  };
}
