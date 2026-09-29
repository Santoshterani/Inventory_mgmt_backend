-- ============================================================================
-- Military Asset Management System — MySQL schema
-- Mirrors requirements.md sections 8 (entities) and 9 (balance definitions).
-- Adds `reserved_quantity` to `inventory` beyond the initial entity list so
-- that transfer creation can reserve stock atomically (see FR-05 / NFR-03:
-- "must not cause available inventory to become negative" and "prevent
-- duplicate inventory effects"). Adjust once the transfer lifecycle in
-- section 13, Q2/Q3 is confirmed.
-- ============================================================================

SET NAMES utf8mb4;
SET FOREIGN_KEY_CHECKS = 0;

-- ---------------------------------------------------------------------------
-- roles — fixed lookup table for section 3 role names
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS roles (
  id            TINYINT UNSIGNED PRIMARY KEY,
  code          VARCHAR(32)  NOT NULL UNIQUE,
  label         VARCHAR(64)  NOT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

INSERT INTO roles (id, code, label) VALUES
  (1, 'ADMIN', 'Admin'),
  (2, 'BASE_COMMANDER', 'Base Commander'),
  (3, 'LOGISTICS_OFFICER', 'Logistics Officer')
ON DUPLICATE KEY UPDATE label = VALUES(label);

-- ---------------------------------------------------------------------------
-- bases
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS bases (
  id            INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  name          VARCHAR(128) NOT NULL UNIQUE,
  location      VARCHAR(255) NULL,
  is_active     TINYINT(1)   NOT NULL DEFAULT 1,
  created_at    DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ---------------------------------------------------------------------------
-- users — FR-01, FR-08. base_id is NULL for Admins (org-wide access).
-- can_create_users lets a project turn on the configurable Base Commander
-- user-creation permission (section 3.4) per account rather than globally.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS users (
  id                INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  name              VARCHAR(128) NOT NULL,
  username          VARCHAR(64)  NOT NULL UNIQUE,
  password_hash     VARCHAR(255) NOT NULL,
  role_id           TINYINT UNSIGNED NOT NULL,
  base_id           INT UNSIGNED NULL,
  can_create_users  TINYINT(1)   NOT NULL DEFAULT 0,
  is_active         TINYINT(1)   NOT NULL DEFAULT 1,
  created_at        DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at        DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT fk_users_role FOREIGN KEY (role_id) REFERENCES roles(id),
  CONSTRAINT fk_users_base FOREIGN KEY (base_id) REFERENCES bases(id),
  INDEX idx_users_role (role_id),
  INDEX idx_users_base (base_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ---------------------------------------------------------------------------
-- equipment_types
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS equipment_types (
  id            INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  name          VARCHAR(128) NOT NULL UNIQUE,
  category      VARCHAR(64)  NULL,
  unit          VARCHAR(32)  NOT NULL DEFAULT 'unit',
  is_active     TINYINT(1)   NOT NULL DEFAULT 1,
  created_at    DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ---------------------------------------------------------------------------
-- inventory — one row per (base, equipment_type). FR-03/NFR-03: never negative.
-- total_quantity    = all units currently held at the base (holdings)
-- assigned_quantity = units currently assigned to personnel (subset of total)
-- reserved_quantity = units earmarked by a PENDING/IN_TRANSIT outbound
--                      transfer, held out of available stock until the
--                      transfer completes or is cancelled
-- available stock    = total_quantity - assigned_quantity - reserved_quantity
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS inventory (
  id                  BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  base_id             INT UNSIGNED NOT NULL,
  equipment_type_id   INT UNSIGNED NOT NULL,
  total_quantity      INT UNSIGNED NOT NULL DEFAULT 0,
  assigned_quantity   INT UNSIGNED NOT NULL DEFAULT 0,
  reserved_quantity   INT UNSIGNED NOT NULL DEFAULT 0,
  updated_at          DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT fk_inventory_base FOREIGN KEY (base_id) REFERENCES bases(id),
  CONSTRAINT fk_inventory_type FOREIGN KEY (equipment_type_id) REFERENCES equipment_types(id),
  CONSTRAINT uq_inventory_base_type UNIQUE (base_id, equipment_type_id),
  CONSTRAINT chk_inventory_nonneg CHECK (
    total_quantity >= 0 AND assigned_quantity >= 0 AND reserved_quantity >= 0
    AND assigned_quantity + reserved_quantity <= total_quantity
  ),
  INDEX idx_inventory_base (base_id),
  INDEX idx_inventory_type (equipment_type_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ---------------------------------------------------------------------------
-- purchases — FR-04
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS purchases (
  id                  BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  base_id             INT UNSIGNED NOT NULL,
  equipment_type_id   INT UNSIGNED NOT NULL,
  quantity            INT UNSIGNED NOT NULL,
  purchase_date       DATE NOT NULL,
  created_by          INT UNSIGNED NOT NULL,
  created_at          DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_purchases_base FOREIGN KEY (base_id) REFERENCES bases(id),
  CONSTRAINT fk_purchases_type FOREIGN KEY (equipment_type_id) REFERENCES equipment_types(id),
  CONSTRAINT fk_purchases_user FOREIGN KEY (created_by) REFERENCES users(id),
  CONSTRAINT chk_purchases_qty CHECK (quantity > 0),
  INDEX idx_purchases_base_date (base_id, purchase_date),
  INDEX idx_purchases_type (equipment_type_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ---------------------------------------------------------------------------
-- transfers — FR-05. status lifecycle: PENDING -> IN_TRANSIT -> COMPLETED,
-- or PENDING/IN_TRANSIT -> CANCELLED. Confirm against section 13, Q2/Q3.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS transfers (
  id                    BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  source_base_id        INT UNSIGNED NOT NULL,
  destination_base_id   INT UNSIGNED NOT NULL,
  status                ENUM('PENDING','IN_TRANSIT','COMPLETED','CANCELLED') NOT NULL DEFAULT 'PENDING',
  created_by            INT UNSIGNED NOT NULL,
  created_at            DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at            DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT fk_transfers_source FOREIGN KEY (source_base_id) REFERENCES bases(id),
  CONSTRAINT fk_transfers_dest FOREIGN KEY (destination_base_id) REFERENCES bases(id),
  CONSTRAINT fk_transfers_user FOREIGN KEY (created_by) REFERENCES users(id),
  CONSTRAINT chk_transfers_diff_base CHECK (source_base_id <> destination_base_id),
  INDEX idx_transfers_status (status),
  INDEX idx_transfers_source (source_base_id),
  INDEX idx_transfers_dest (destination_base_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS transfer_items (
  id                  BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  transfer_id         BIGINT UNSIGNED NOT NULL,
  equipment_type_id   INT UNSIGNED NOT NULL,
  quantity            INT UNSIGNED NOT NULL,
  CONSTRAINT fk_titems_transfer FOREIGN KEY (transfer_id) REFERENCES transfers(id) ON DELETE CASCADE,
  CONSTRAINT fk_titems_type FOREIGN KEY (equipment_type_id) REFERENCES equipment_types(id),
  CONSTRAINT chk_titems_qty CHECK (quantity > 0),
  INDEX idx_titems_transfer (transfer_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- Status history, so the UI's "status history" panel and audit trail have a
-- durable source (NFR-04: preserve transaction history to explain changes).
CREATE TABLE IF NOT EXISTS transfer_status_history (
  id            BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  transfer_id   BIGINT UNSIGNED NOT NULL,
  status        ENUM('PENDING','IN_TRANSIT','COMPLETED','CANCELLED') NOT NULL,
  changed_by    INT UNSIGNED NOT NULL,
  changed_at    DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_tsh_transfer FOREIGN KEY (transfer_id) REFERENCES transfers(id) ON DELETE CASCADE,
  CONSTRAINT fk_tsh_user FOREIGN KEY (changed_by) REFERENCES users(id),
  INDEX idx_tsh_transfer (transfer_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ---------------------------------------------------------------------------
-- assignments — FR-06. personnel are recorded as free-text name/ID per the
-- open question in section 13, Q6 (no separate personnel entity yet).
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS assignments (
  id                  BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  base_id             INT UNSIGNED NOT NULL,
  equipment_type_id   INT UNSIGNED NOT NULL,
  quantity            INT UNSIGNED NOT NULL,
  personnel_name      VARCHAR(128) NOT NULL,
  assigned_by         INT UNSIGNED NOT NULL,
  status              ENUM('ACTIVE','RETURNED') NOT NULL DEFAULT 'ACTIVE',
  assigned_at         DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  returned_at         DATETIME NULL,
  CONSTRAINT fk_assign_base FOREIGN KEY (base_id) REFERENCES bases(id),
  CONSTRAINT fk_assign_type FOREIGN KEY (equipment_type_id) REFERENCES equipment_types(id),
  CONSTRAINT fk_assign_user FOREIGN KEY (assigned_by) REFERENCES users(id),
  CONSTRAINT chk_assign_qty CHECK (quantity > 0),
  INDEX idx_assign_base (base_id),
  INDEX idx_assign_status (status)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ---------------------------------------------------------------------------
-- expenditures — FR-07. references the assignment it is drawn against.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS expenditures (
  id              BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  assignment_id   BIGINT UNSIGNED NOT NULL,
  quantity        INT UNSIGNED NOT NULL,
  recorded_by     INT UNSIGNED NOT NULL,
  expended_at     DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  remarks         VARCHAR(500) NULL,
  CONSTRAINT fk_exp_assignment FOREIGN KEY (assignment_id) REFERENCES assignments(id),
  CONSTRAINT fk_exp_user FOREIGN KEY (recorded_by) REFERENCES users(id),
  CONSTRAINT chk_exp_qty CHECK (quantity > 0),
  INDEX idx_exp_assignment (assignment_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ---------------------------------------------------------------------------
-- audit_logs — FR-09. Application layer only ever INSERTs; no UPDATE/DELETE
-- grants should be given to the app DB user for this table (NFR-04).
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS audit_logs (
  id              BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  actor_id        INT UNSIGNED NULL,
  action          VARCHAR(64)  NOT NULL,
  entity_type     VARCHAR(64)  NOT NULL,
  entity_id       VARCHAR(64)  NULL,
  details         JSON         NULL,
  created_at      DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_audit_actor FOREIGN KEY (actor_id) REFERENCES users(id) ON DELETE SET NULL,
  INDEX idx_audit_entity (entity_type, entity_id),
  INDEX idx_audit_actor (actor_id),
  INDEX idx_audit_created (created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

SET FOREIGN_KEY_CHECKS = 1;
