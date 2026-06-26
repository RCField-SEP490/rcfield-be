import { Router } from 'express';
import { authenticate, authorize } from '../middlewares/auth.middleware';
import { UserRole } from '../types';
import { customerVehicleController } from '../controllers/customer-vehicle.controller';

const customerVehicleRouter = Router();

customerVehicleRouter.use(authenticate);
customerVehicleRouter.use(authorize(UserRole.CUSTOMER));

customerVehicleRouter.post('/', customerVehicleController.createVehicle);
customerVehicleRouter.get('/', customerVehicleController.listVehicles);
customerVehicleRouter.get('/:id', customerVehicleController.getVehicle);
customerVehicleRouter.patch('/:id', customerVehicleController.updateVehicle);
customerVehicleRouter.delete('/:id', customerVehicleController.deleteVehicle);

export { customerVehicleRouter };
