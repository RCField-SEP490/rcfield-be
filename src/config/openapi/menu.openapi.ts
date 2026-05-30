import { OpenApiGeneratorV3, OpenAPIRegistry } from '@asteasolutions/zod-to-openapi';
import { z } from 'zod';
import {
  CafeIdParamsSchema,
  CreateMenuItemSchema,
  MenuItemParamsSchema,
  MenuItemResponseSchema,
  MenuListQuerySchema,
  UpdateMenuItemSchema,
} from '../../validate';

const registry = new OpenAPIRegistry();

const MenuItem = registry.register('MenuItem', MenuItemResponseSchema);
const CreateMenuItemRequest = registry.register('CreateMenuItemRequest', CreateMenuItemSchema);
const UpdateMenuItemRequest = registry.register('UpdateMenuItemRequest', UpdateMenuItemSchema);
const MenuListQuery = registry.register('MenuListQuery', MenuListQuerySchema);
const CafeIdParams = registry.register('CafeIdParams', CafeIdParamsSchema);
const MenuItemParams = registry.register('MenuItemParams', MenuItemParamsSchema);

const menuListResponse = z.object({
  success: z.boolean().openapi({ example: true }),
  data: z.array(MenuItem),
  meta: z.object({
    total: z.number().int().openapi({ example: 4 }),
    page: z.number().int().openapi({ example: 1 }),
    limit: z.number().int().openapi({ example: 20 }),
  }),
});

const menuItemResponse = z.object({
  success: z.boolean().openapi({ example: true }),
  data: MenuItem,
});

const commonErrors = {
  400: { $ref: '#/components/responses/BadRequest' },
  401: { $ref: '#/components/responses/Unauthorized' },
  403: { $ref: '#/components/responses/Forbidden' },
  404: { $ref: '#/components/responses/NotFound' },
  500: { $ref: '#/components/responses/InternalServerError' },
};

const json = (schema: z.ZodTypeAny) => ({
  'application/json': {
    schema,
  },
});

registry.registerPath({
  method: 'get',
  path: '/api/v1/cafes/{cafeId}/menu',
  tags: ['Menu'],
  summary: 'List cafe menu items',
  description: 'Provider lay danh sach mon an/uong cua cafe thuoc so huu cua minh.',
  security: [{ bearerAuth: [] }],
  request: {
    params: CafeIdParams,
    query: MenuListQuery,
  },
  responses: {
    200: {
      description: 'Danh sach menu item.',
      content: json(menuListResponse),
    },
    ...commonErrors,
  },
});

registry.registerPath({
  method: 'post',
  path: '/api/v1/cafes/{cafeId}/menu',
  tags: ['Menu'],
  summary: 'Create cafe menu item',
  description: 'Provider tao mon an/uong moi cho cafe thuoc so huu cua minh.',
  security: [{ bearerAuth: [] }],
  request: {
    params: CafeIdParams,
    body: {
      required: true,
      content: json(CreateMenuItemRequest),
    },
  },
  responses: {
    201: {
      description: 'Menu item moi duoc tao.',
      content: json(menuItemResponse),
    },
    ...commonErrors,
  },
});

registry.registerPath({
  method: 'patch',
  path: '/api/v1/cafes/{cafeId}/menu/{itemId}',
  tags: ['Menu'],
  summary: 'Update cafe menu item',
  description: 'Provider cap nhat mot mon an/uong cua cafe thuoc so huu cua minh.',
  security: [{ bearerAuth: [] }],
  request: {
    params: MenuItemParams,
    body: {
      required: true,
      content: json(UpdateMenuItemRequest),
    },
  },
  responses: {
    200: {
      description: 'Menu item sau khi cap nhat.',
      content: json(menuItemResponse),
    },
    ...commonErrors,
  },
});

registry.registerPath({
  method: 'delete',
  path: '/api/v1/cafes/{cafeId}/menu/{itemId}',
  tags: ['Menu'],
  summary: 'Delete cafe menu item',
  description: 'Provider soft-delete mot mon an/uong cua cafe thuoc so huu cua minh.',
  security: [{ bearerAuth: [] }],
  request: {
    params: MenuItemParams,
  },
  responses: {
    204: {
      description: 'Menu item da duoc soft-delete.',
    },
    ...commonErrors,
  },
});

const generator = new OpenApiGeneratorV3(registry.definitions);

export const menuOpenApiDocument = generator.generateDocument({
  openapi: '3.0.3',
  info: {
    title: 'RCField Menu API',
    version: '1.0.0',
  },
});
