-- --------------------------------------------------------
-- Host:                         127.0.0.1
-- Server Version:               10.4.11-MariaDB - mariadb.org binary distribution
-- Server Betriebssystem:        Win64
-- HeidiSQL Version:             10.2.0.5599
-- --------------------------------------------------------

/*!40101 SET @OLD_CHARACTER_SET_CLIENT=@@CHARACTER_SET_CLIENT */;
/*!40101 SET NAMES utf8 */;
/*!50503 SET NAMES utf8mb4 */;
/*!40014 SET @OLD_FOREIGN_KEY_CHECKS=@@FOREIGN_KEY_CHECKS, FOREIGN_KEY_CHECKS=0 */;
/*!40101 SET @OLD_SQL_MODE=@@SQL_MODE, SQL_MODE='NO_AUTO_VALUE_ON_ZERO' */;


-- Exportiere Datenbank Struktur für hd_replication_db
CREATE DATABASE IF NOT EXISTS `hd_replication_db` /*!40100 DEFAULT CHARACTER SET utf16 COLLATE utf16_bin */;
USE `hd_replication_db`;

-- Exportiere Struktur von Tabelle hd_replication_db.bank_landslides
CREATE TABLE IF NOT EXISTS `bank_landslides` (
  `event_id` varchar(200) COLLATE utf16_bin NOT NULL,
  `event_title` varchar(500) COLLATE utf16_bin DEFAULT NULL,
  `source_name` varchar(500) COLLATE utf16_bin DEFAULT NULL,
  `event_date` date DEFAULT NULL,
  `country_name` varchar(500) COLLATE utf16_bin DEFAULT NULL,
  `landslide_setting` varchar(500) COLLATE utf16_bin DEFAULT NULL,
  `gold` int(11) NOT NULL DEFAULT 0,
  UNIQUE KEY `i` (`event_id`),
  KEY `n` (`event_title`),
  KEY `nUi` (`event_title`,`event_id`),
  KEY `sUi` (`source_name`,`event_id`),
  KEY `s` (`source_name`),
  KEY `tUi` (`event_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf16 COLLATE=utf16_bin ROW_FORMAT=DYNAMIC;

-- Daten Export vom Benutzer nicht ausgewählt

-- Exportiere Struktur von Tabelle hd_replication_db.bank_names
CREATE TABLE IF NOT EXISTS `bank_names` (
  `uid` varchar(50) COLLATE utf16_bin NOT NULL,
  `sn` varchar(200) COLLATE utf16_bin DEFAULT NULL,
  `gold` int(11) NOT NULL DEFAULT 0,
  UNIQUE KEY `t` (`uid`),
  UNIQUE KEY `ts` (`sn`,`uid`),
  KEY `s` (`sn`),
  KEY `i` (`gold`)
) ENGINE=InnoDB DEFAULT CHARSET=utf16 COLLATE=utf16_bin ROW_FORMAT=DYNAMIC;

-- Daten Export vom Benutzer nicht ausgewählt

-- Exportiere Struktur von Prozedur hd_replication_db.bank_transfer_landslides
DELIMITER //
CREATE DEFINER=`root`@`localhost` PROCEDURE `bank_transfer_landslides`(
	IN `c` INT



)
BEGIN		
		
		DECLARE d INT;
		SET d = COALESCE(c, (SELECT FLOOR(COUNT(*)/2) FROM hd_mock_landslides));
		
		CREATE TEMPORARY TABLE q1(v VARCHAR(200));
		INSERT INTO q1 SELECT event_id FROM hd_mock_landslides WHERE gold = 0 ORDER BY RAND() LIMIT d; 
	
		INSERT INTO bank_landslides SELECT * FROM hd_mock_landslides WHERE event_id IN (SELECT v FROM q1);
		DELETE FROM hd_mock_landslides WHERE event_id IN (SELECT v FROM q1);
		DROP TEMPORARY TABLE q1;

	END//
DELIMITER ;

-- Exportiere Struktur von Prozedur hd_replication_db.bank_transfer_names
DELIMITER //
CREATE DEFINER=`root`@`localhost` PROCEDURE `bank_transfer_names`(
	IN `c` INT











)
BEGIN		
		
		DECLARE d INT;
		SET d = COALESCE(c, (SELECT FLOOR(COUNT(*)/2) FROM hd_mock_names));
		
		CREATE TEMPORARY TABLE q1(v VARCHAR(200));
		INSERT INTO q1 SELECT uid FROM hd_mock_names WHERE gold = 0 ORDER BY RAND() LIMIT d; 
	
		INSERT INTO bank_names SELECT * FROM hd_mock_names WHERE uid IN (SELECT v FROM q1);
		DELETE FROM hd_mock_names WHERE uid IN (SELECT v FROM q1);
		DROP TEMPORARY TABLE q1;

	END//
DELIMITER ;

-- Exportiere Struktur von Prozedur hd_replication_db.db_transfer_landslides
DELIMITER //
CREATE DEFINER=`root`@`localhost` PROCEDURE `db_transfer_landslides`(
	IN `c` INT

)
BEGIN
		CREATE TEMPORARY TABLE q1(v VARCHAR(200));
		INSERT INTO q1 SELECT event_id FROM bank_landslides ORDER BY RAND() LIMIT c; 

		INSERT INTO hd_mock_landslides SELECT * FROM bank_landslides WHERE event_id IN (SELECT v FROM q1);
		DELETE FROM bank_landslides WHERE event_id IN (SELECT v FROM q1);
		DROP TEMPORARY TABLE q1;

	END//
DELIMITER ;

-- Exportiere Struktur von Prozedur hd_replication_db.db_transfer_names
DELIMITER //
CREATE DEFINER=`root`@`localhost` PROCEDURE `db_transfer_names`(
	IN `c` INT




)
BEGIN
		CREATE TEMPORARY TABLE q1(v VARCHAR(200));
		INSERT INTO q1 SELECT uid FROM bank_names ORDER BY RAND() LIMIT c; 

		INSERT INTO hd_mock_names SELECT * FROM bank_names WHERE uid IN (SELECT v FROM q1);
		DELETE FROM bank_names WHERE uid IN (SELECT v FROM q1);
		DROP TEMPORARY TABLE q1;

	END//
DELIMITER ;

-- Exportiere Struktur von Tabelle hd_replication_db.hd_mock_landslides
CREATE TABLE IF NOT EXISTS `hd_mock_landslides` (
  `event_id` varchar(200) COLLATE utf16_bin NOT NULL,
  `event_title` varchar(500) COLLATE utf16_bin DEFAULT NULL,
  `source_name` varchar(500) COLLATE utf16_bin DEFAULT NULL,
  `event_date` date DEFAULT NULL,
  `country_name` varchar(500) COLLATE utf16_bin DEFAULT NULL,
  `landslide_setting` varchar(500) COLLATE utf16_bin DEFAULT NULL,
  `gold` int(11) NOT NULL DEFAULT 0,
  UNIQUE KEY `i` (`event_id`),
  KEY `n` (`event_title`),
  KEY `nUi` (`event_title`,`event_id`),
  KEY `sUi` (`source_name`,`event_id`),
  KEY `s` (`source_name`),
  KEY `tUi` (`event_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf16 COLLATE=utf16_bin;

-- Daten Export vom Benutzer nicht ausgewählt

-- Exportiere Struktur von Tabelle hd_replication_db.hd_mock_names
CREATE TABLE IF NOT EXISTS `hd_mock_names` (
  `uid` varchar(50) COLLATE utf16_bin NOT NULL,
  `sn` varchar(200) COLLATE utf16_bin NOT NULL,
  `gold` tinyint(4) NOT NULL DEFAULT 0,
  UNIQUE KEY `t` (`uid`),
  UNIQUE KEY `ts` (`sn`,`uid`),
  KEY `s` (`sn`),
  KEY `i` (`gold`)
) ENGINE=InnoDB DEFAULT CHARSET=utf16 COLLATE=utf16_bin;

-- Daten Export vom Benutzer nicht ausgewählt

-- Exportiere Struktur von Tabelle hd_replication_db.maintenancelist
CREATE TABLE IF NOT EXISTS `maintenancelist` (
  `id` int(11) NOT NULL,
  `field` varchar(50) COLLATE utf16_bin NOT NULL,
  `start` varchar(500) COLLATE utf16_bin NOT NULL,
  `end` varchar(500) COLLATE utf16_bin NOT NULL,
  `amount` int(11) NOT NULL DEFAULT 0,
  `lodisStart` varchar(500) COLLATE utf16_bin DEFAULT NULL,
  `lodisEnd` varchar(500) COLLATE utf16_bin DEFAULT NULL,
  `timestamp` timestamp NOT NULL DEFAULT current_timestamp(),
  UNIQUE KEY `pk` (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf16 COLLATE=utf16_bin ROW_FORMAT=DYNAMIC;

-- Daten Export vom Benutzer nicht ausgewählt

-- Exportiere Struktur von Tabelle hd_replication_db.splinter
CREATE TABLE IF NOT EXISTS `splinter` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `field` varchar(50) COLLATE utf16_bin NOT NULL,
  `start` varchar(500) COLLATE utf16_bin NOT NULL,
  `end` varchar(500) COLLATE utf16_bin NOT NULL,
  `amount` int(11) NOT NULL DEFAULT 0,
  `lodisStart` varchar(500) COLLATE utf16_bin DEFAULT NULL,
  `lodisEnd` varchar(500) COLLATE utf16_bin DEFAULT NULL,
  `timestamp` timestamp NOT NULL DEFAULT current_timestamp(),
  PRIMARY KEY (`id`)
) ENGINE=InnoDB AUTO_INCREMENT=1056 DEFAULT CHARSET=utf16 COLLATE=utf16_bin ROW_FORMAT=DYNAMIC;

-- Daten Export vom Benutzer nicht ausgewählt

-- Exportiere Struktur von Tabelle hd_replication_db.u_loc_dry_landslides
CREATE TABLE IF NOT EXISTS `u_loc_dry_landslides` (
  `event_id` varchar(200) COLLATE utf16_bin NOT NULL,
  `event_title` varchar(500) COLLATE utf16_bin DEFAULT NULL,
  `source_name` varchar(500) COLLATE utf16_bin DEFAULT NULL,
  `event_date` date DEFAULT NULL,
  `country_name` varchar(500) COLLATE utf16_bin DEFAULT NULL,
  `landslide_setting` varchar(500) COLLATE utf16_bin DEFAULT NULL,
  UNIQUE KEY `i` (`event_id`),
  KEY `n` (`event_title`),
  KEY `nUi` (`event_title`,`event_id`),
  KEY `sUi` (`source_name`,`event_id`),
  KEY `s` (`source_name`),
  KEY `tUi` (`event_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf16 COLLATE=utf16_bin ROW_FORMAT=DYNAMIC;

-- Daten Export vom Benutzer nicht ausgewählt

-- Exportiere Struktur von Tabelle hd_replication_db.u_loc_dry_names
CREATE TABLE IF NOT EXISTS `u_loc_dry_names` (
  `uid` varchar(50) COLLATE utf16_bin NOT NULL,
  `sn` varchar(200) COLLATE utf16_bin DEFAULT NULL,
  `gold` int(11) NOT NULL DEFAULT 0
) ENGINE=InnoDB DEFAULT CHARSET=utf16 COLLATE=utf16_bin ROW_FORMAT=DYNAMIC;

-- Daten Export vom Benutzer nicht ausgewählt

-- Exportiere Struktur von Tabelle hd_replication_db.u_loc_landslides
CREATE TABLE IF NOT EXISTS `u_loc_landslides` (
  `event_id` varchar(200) COLLATE utf16_bin NOT NULL,
  `event_title` varchar(500) COLLATE utf16_bin DEFAULT NULL,
  `source_name` varchar(500) COLLATE utf16_bin DEFAULT NULL,
  `event_date` date DEFAULT NULL,
  `country_name` varchar(500) COLLATE utf16_bin DEFAULT NULL,
  `landslide_setting` varchar(500) COLLATE utf16_bin DEFAULT NULL,
  UNIQUE KEY `i` (`event_id`),
  KEY `n` (`event_title`),
  KEY `nUi` (`event_title`,`event_id`),
  KEY `sUi` (`source_name`,`event_id`),
  KEY `s` (`source_name`),
  KEY `tUi` (`event_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf16 COLLATE=utf16_bin ROW_FORMAT=DYNAMIC;

-- Daten Export vom Benutzer nicht ausgewählt

-- Exportiere Struktur von Tabelle hd_replication_db.u_loc_names
CREATE TABLE IF NOT EXISTS `u_loc_names` (
  `uid` varchar(50) COLLATE utf16_bin NOT NULL,
  `sn` varchar(200) COLLATE utf16_bin DEFAULT NULL,
  `gold` int(11) NOT NULL DEFAULT 0,
  UNIQUE KEY `t` (`uid`),
  UNIQUE KEY `ts` (`sn`,`uid`),
  KEY `s` (`sn`),
  KEY `i` (`gold`)
) ENGINE=InnoDB DEFAULT CHARSET=utf16 COLLATE=utf16_bin ROW_FORMAT=DYNAMIC;

-- Daten Export vom Benutzer nicht ausgewählt

-- Exportiere Struktur von Tabelle hd_replication_db.u_loc_ncsu
CREATE TABLE IF NOT EXISTS `u_loc_ncsu` (
  `uid` varchar(50) COLLATE utf16_bin NOT NULL,
  `sn` varchar(200) COLLATE utf16_bin DEFAULT NULL,
  `gold` int(11) NOT NULL DEFAULT 0,
  UNIQUE KEY `t` (`uid`),
  UNIQUE KEY `ts` (`sn`,`uid`),
  KEY `s` (`sn`),
  KEY `i` (`gold`)
) ENGINE=InnoDB DEFAULT CHARSET=utf16 COLLATE=utf16_bin ROW_FORMAT=DYNAMIC;

-- Daten Export vom Benutzer nicht ausgewählt

/*!40101 SET SQL_MODE=IFNULL(@OLD_SQL_MODE, '') */;
/*!40014 SET FOREIGN_KEY_CHECKS=IF(@OLD_FOREIGN_KEY_CHECKS IS NULL, 1, @OLD_FOREIGN_KEY_CHECKS) */;
/*!40101 SET CHARACTER_SET_CLIENT=@OLD_CHARACTER_SET_CLIENT */;
