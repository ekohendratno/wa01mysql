/*
SQLyog Ultimate v13.1.1 (64 bit)
MySQL - 8.0.30 : Database - wapi
*********************************************************************
*/

/*!40101 SET NAMES utf8 */;

/*!40101 SET SQL_MODE=''*/;

/*!40014 SET @OLD_UNIQUE_CHECKS=@@UNIQUE_CHECKS, UNIQUE_CHECKS=0 */;
/*!40014 SET @OLD_FOREIGN_KEY_CHECKS=@@FOREIGN_KEY_CHECKS, FOREIGN_KEY_CHECKS=0 */;
/*!40101 SET @OLD_SQL_MODE=@@SQL_MODE, SQL_MODE='NO_AUTO_VALUE_ON_ZERO' */;
/*!40111 SET @OLD_SQL_NOTES=@@SQL_NOTES, SQL_NOTES=0 */;
/*Table structure for table `contacts` */

DROP TABLE IF EXISTS `contacts`;

CREATE TABLE `contacts` (
  `id` int NOT NULL AUTO_INCREMENT,
  `uid` int NOT NULL,
  `device_id` int NOT NULL,
  `jid` varchar(100) CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci NOT NULL,
  `phone` varchar(100) CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci DEFAULT NULL,
  `name` varchar(255) CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci DEFAULT NULL,
  `updated_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `unique_jid` (`uid`,`device_id`,`jid`)
) ENGINE=InnoDB AUTO_INCREMENT=3 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

/*Data for the table `contacts` */

insert  into `contacts`(`id`,`uid`,`device_id`,`jid`,`phone`,`name`,`updated_at`) values 
(1,3,5,'6285769641780@s.whatsapp.net','6285769641780',NULL,'2026-02-01 12:26:38'),
(2,3,5,'101915379667185@lid',NULL,'EKO HENDRATNO','2026-02-01 12:26:51');

/*Table structure for table `messages` */

DROP TABLE IF EXISTS `messages`;

CREATE TABLE `messages` (
  `id` int NOT NULL AUTO_INCREMENT,
  `uid` int NOT NULL,
  `device_id` int NOT NULL,
  `number` varchar(30) CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci DEFAULT NULL,
  `message` text CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci,
  `type` enum('personal','bulk','group') CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci NOT NULL,
  `tags` varchar(30) CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci DEFAULT NULL,
  `status` enum('pending','sent','failed','processing') CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci DEFAULT 'pending',
  `response` text CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci,
  `created_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` timestamp NULL DEFAULT NULL,
  PRIMARY KEY (`id`),
  KEY `device_id` (`device_id`)
) ENGINE=InnoDB AUTO_INCREMENT=2 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

/*Data for the table `messages` */

insert  into `messages`(`id`,`uid`,`device_id`,`number`,`message`,`type`,`tags`,`status`,`response`,`created_at`,`updated_at`) values 
(1,3,5,'6285769641780','Halo, ini adalah layanan notifikasi otomatis. Balas pesan ini dengan ketik \'SETUJU\' untuk menerima informasi dan pembaruan dari kami secara otomatis melalui WhatsApp. Balas \'STOP\' jika ingin berhenti berlangganan. Terima kasih!','personal','opt-in','sent','{\"status\":true,\"message\":\"Message processing completed.\",\"data\":{\"results\":[{\"recipient\":\"6285769641780\",\"status\":true,\"message\":\"Message sent successfully.\",\"messageId\":\"3EB042260A9C50BBAB0D5B\"}],\"invalidRecipients\":[]}}','2026-02-01 12:25:53','2026-02-01 12:26:20');

/*Table structure for table `opt_ins` */

DROP TABLE IF EXISTS `opt_ins`;

CREATE TABLE `opt_ins` (
  `id` int NOT NULL AUTO_INCREMENT,
  `uid` int NOT NULL,
  `device_id` int NOT NULL,
  `number` varchar(50) CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci NOT NULL,
  `status` enum('pending','approved','blocked') CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci DEFAULT 'pending',
  `source` varchar(50) CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci DEFAULT 'chat',
  `agreed_at` timestamp NULL DEFAULT NULL,
  `created_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `unique_opt_in` (`uid`,`number`)
) ENGINE=InnoDB AUTO_INCREMENT=2 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

/*Data for the table `opt_ins` */

insert  into `opt_ins`(`id`,`uid`,`device_id`,`number`,`status`,`source`,`agreed_at`,`created_at`,`updated_at`) values 
(1,3,5,'101915379667185','approved','chat_explicit','2026-02-01 12:26:51','2026-02-01 12:26:51','2026-02-01 12:26:51');

/*!40101 SET SQL_MODE=@OLD_SQL_MODE */;
/*!40014 SET FOREIGN_KEY_CHECKS=@OLD_FOREIGN_KEY_CHECKS */;
/*!40014 SET UNIQUE_CHECKS=@OLD_UNIQUE_CHECKS */;
/*!40111 SET SQL_NOTES=@OLD_SQL_NOTES */;
