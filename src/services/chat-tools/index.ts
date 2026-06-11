import {
  definition as checkAvailabilityDef,
  handler as checkAvailabilityHandler,
} from './check-availability';
import type { CheckAvailabilityArgs } from './check-availability';

// Danh sách tool definitions gửi lên Gemini
export const toolDefinitions = [
  checkAvailabilityDef,
  // Thêm tool mới vào đây:
  // vehicleListDef,
  // menuSummaryDef,
  // bookingStatusDef,
];

// Dispatcher: nhận tên tool + args, gọi đúng handler
// cafeId luôn đến từ widget context, không bao giờ từ args
export async function dispatchTool(
  cafeId: string,
  toolName: string,
  args: Record<string, unknown>,
): Promise<string> {
  switch (toolName) {
    case 'check_availability':
      return checkAvailabilityHandler(cafeId, args as CheckAvailabilityArgs);
    // case 'list_vehicles':
    //   return listVehiclesHandler(cafeId, args as ListVehiclesArgs);
    default:
      return JSON.stringify({ error: `Unknown tool: ${toolName}` });
  }
}
