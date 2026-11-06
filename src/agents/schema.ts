import { Type } from 'typebox';

// Shared configuration must not import catalog discovery just to validate a thinking value.
export const thinkingSchema = Type.Union([Type.Literal('off'), Type.Literal('minimal'), Type.Literal('low'),
  Type.Literal('medium'), Type.Literal('high'), Type.Literal('xhigh'), Type.Literal('max')]);
