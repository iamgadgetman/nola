-- Run this on EACH MariaDB/MySQL server NOLA should monitor.
-- Creates a least-privilege, read-only user for mysqld_exporter.
-- Replace the password, then keep it in sync with deploy/holodeck/.env (DB_MON_PASS).

CREATE USER IF NOT EXISTS 'nola_exporter'@'%'
  IDENTIFIED BY 'REPLACE_WITH_STRONG_PASSWORD'
  WITH MAX_USER_CONNECTIONS 3;

-- PROCESS: see all sessions (threads_connected/running)
-- REPLICATION CLIENT / SLAVE MONITOR: replication lag (harmless if no replication)
-- SELECT: read information_schema for sizes/collectors
GRANT PROCESS, REPLICATION CLIENT, SELECT ON *.* TO 'nola_exporter'@'%';

-- MariaDB 10.5+ prefers SLAVE MONITOR over REPLICATION CLIENT; uncomment if the
-- GRANT above errors on "REPLICATION CLIENT":
-- GRANT PROCESS, SLAVE MONITOR, SELECT ON *.* TO 'nola_exporter'@'%';

FLUSH PRIVILEGES;

-- Hardening: replace '%' with the holodeck host / docker subnet the exporter
-- connects from, e.g. 'nola_exporter'@'172.16.0.0/255.240.0.0'.
