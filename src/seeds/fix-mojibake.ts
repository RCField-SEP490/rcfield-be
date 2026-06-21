import 'dotenv/config';
import 'reflect-metadata';
import { AppDataSource } from '../config/database';
import { logger } from '../config/logger';

async function fix() {
  await AppDataSource.initialize();
  logger.database('Connected for Mojibake fix');

  logger.info('Fix', 'Updating shift_positions table...');
  const res1 = await AppDataSource.query(`
    UPDATE shift_positions 
    SET name = CASE 
      WHEN name = 'Lá»… tÃ¢n' OR name ILIKE '%Lá»…%' THEN 'Lễ tân'
      WHEN name = 'GiÃ¡m sÃ¡t' OR name ILIKE '%GiÃ¡m%' THEN 'Giám sát'
      WHEN name = 'Ká»¹ thuáº­t' OR name ILIKE '%Ká»¹%' THEN 'Kỹ thuật'
      ELSE name
    END
    WHERE name = 'Lá»… tÃ¢n' OR name ILIKE '%Lá»…%'
       OR name = 'GiÃ¡m sÃ¡t' OR name ILIKE '%GiÃ¡m%'
       OR name = 'Ká»¹ thuáº­t' OR name ILIKE '%Ká»¹%'
  `);
  logger.info('Fix', `Updated shift_positions: ${JSON.stringify(res1)}`);

  logger.info('Fix', 'Updating shift_time_presets table...');
  const res2 = await AppDataSource.query(`
    UPDATE shift_time_presets 
    SET label = CASE 
      WHEN label = 'SÃ¡ng (08-14)' OR label ILIKE '%SÃ¡ng%' THEN 'Sáng (08-14)'
      WHEN label = 'Chiá» u (14-20)' OR label ILIKE '%Chiá»%' THEN 'Chiều (14-20)'
      WHEN label = 'Tá»‘i (18-24)' OR label ILIKE '%Tá»‘i%' THEN 'Tối (18-24)'
      WHEN label = 'Cáº£ ngÃ\u00a0y (09-18)' OR label ILIKE '%Cáº£%' THEN 'Cả ngày (09-18)'
      ELSE label
    END
    WHERE label = 'SÃ¡ng (08-14)' OR label ILIKE '%SÃ¡ng%'
       OR label = 'Chiá» u (14-20)' OR label ILIKE '%Chiá»%'
       OR label = 'Tá»‘i (18-24)' OR label ILIKE '%Tá»‘i%'
       OR label = 'Cáº£ ngÃ\u00a0y (09-18)' OR label ILIKE '%Cáº£%'
  `);
  logger.info('Fix', `Updated shift_time_presets: ${JSON.stringify(res2)}`);

  logger.info('Fix', 'Updating staff_shifts table...');
  const res3 = await AppDataSource.query(`
    UPDATE staff_shifts 
    SET shift_label = CASE 
      WHEN shift_label = 'SÃ¡ng (08-14)' OR shift_label ILIKE '%SÃ¡ng%' THEN 'Sáng (08-14)'
      WHEN shift_label = 'Chiá» u (14-20)' OR shift_label ILIKE '%Chiá»%' THEN 'Chiều (14-20)'
      WHEN shift_label = 'Tá»‘i (18-24)' OR shift_label ILIKE '%Tá»‘i%' THEN 'Tối (18-24)'
      WHEN shift_label = 'Cáº£ ngÃ\u00a0y (09-18)' OR shift_label ILIKE '%Cáº£%' THEN 'Cả ngày (09-18)'
      ELSE shift_label
    END
    WHERE shift_label = 'SÃ¡ng (08-14)' OR shift_label ILIKE '%SÃ¡ng%'
       OR shift_label = 'Chiá» u (14-20)' OR shift_label ILIKE '%Chiá»%'
       OR shift_label = 'Tá»‘i (18-24)' OR shift_label ILIKE '%Tá»‘i%'
       OR shift_label = 'Cáº£ ngÃ\u00a0y (09-18)' OR shift_label ILIKE '%Cáº£%'
  `);
  logger.info('Fix', `Updated staff_shifts: ${JSON.stringify(res3)}`);

  await AppDataSource.destroy();
  logger.info('Fix', 'Mojibake database fix completed successfully.');
}

fix().catch((err) => {
  logger.error('Fix', 'Failed fixing Mojibake data', err);
  process.exit(1);
});
