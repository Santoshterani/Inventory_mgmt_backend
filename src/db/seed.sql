-- Sample reference and demo data. Safe to run after schema.sql on an empty DB.
-- The bootstrap admin account is created separately by `npm run db:init`
-- (see src/db/init.js) so its password is hashed properly, not stored here.

INSERT INTO bases (name, location) VALUES
  ('Fort Alpha', 'Northern Command'),
  ('Fort Bravo', 'Eastern Command'),
  ('Fort Charlie', 'Western Command')
ON DUPLICATE KEY UPDATE location = VALUES(location);

INSERT INTO equipment_types (name, category, unit) VALUES
  ('Rifle - M4', 'Small Arms', 'unit'),
  ('Vehicle - MRAP', 'Vehicles', 'unit'),
  ('Ammunition - 5.56mm', 'Ammunition', 'round'),
  ('Radio Set', 'Communications', 'unit')
ON DUPLICATE KEY UPDATE category = VALUES(category);
