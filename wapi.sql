-- phpMyAdmin SQL Dump
-- version 5.2.2
-- https://www.phpmyadmin.net/
--
-- Host: 127.0.0.1:3306
-- Generation Time: Jun 05, 2025 at 05:46 PM
-- Server version: 8.0.41-0ubuntu0.22.04.1
-- PHP Version: 8.1.31

SET SQL_MODE = "NO_AUTO_VALUE_ON_ZERO";
START TRANSACTION;
SET time_zone = "+00:00";


/*!40101 SET @OLD_CHARACTER_SET_CLIENT=@@CHARACTER_SET_CLIENT */;
/*!40101 SET @OLD_CHARACTER_SET_RESULTS=@@CHARACTER_SET_RESULTS */;
/*!40101 SET @OLD_COLLATION_CONNECTION=@@COLLATION_CONNECTION */;
/*!40101 SET NAMES utf8mb4 */;

--
-- Database: `jasaedukasi-wapi`
--

-- --------------------------------------------------------

--
-- Table structure for table `autoreply`
--

CREATE TABLE `autoreply` (
  `id` int NOT NULL,
  `uid` int NOT NULL,
  `keyword` varchar(255) COLLATE utf8mb4_general_ci NOT NULL,
  `response` text COLLATE utf8mb4_general_ci NOT NULL,
  `status` enum('active','inactive') COLLATE utf8mb4_general_ci NOT NULL,
  `used` int DEFAULT NULL,
  `created_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  `is_for_personal` tinyint(1) DEFAULT '1',
  `is_for_group` tinyint(1) DEFAULT '0'
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

--
-- Dumping data for table `autoreply`
--

INSERT INTO `autoreply` (`id`, `uid`, `keyword`, `response`, `status`, `used`, `created_at`, `updated_at`, `is_for_personal`, `is_for_group`) VALUES
(1, 3, 'Hai', 'Halo! Ada yang bisa kami bantu?', 'active', NULL, '2025-02-03 22:02:33', '2025-02-03 22:02:33', 1, 0),
(2, 3, 'Harga', 'Berikut adalah daftar harga produk kami...', 'active', NULL, '2025-02-03 22:02:33', '2025-02-03 22:02:33', 1, 1),
(3, 3, 'Info', 'Silakan hubungi admin untuk informasi lebih lanjut.', 'inactive', NULL, '2025-02-03 22:02:33', '2025-02-03 22:02:33', 1, 1);

-- --------------------------------------------------------

--
-- Table structure for table `balances`
--

CREATE TABLE `balances` (
  `uid` int NOT NULL,
  `balance` decimal(10,2) NOT NULL DEFAULT '0.00',
  `total_used` decimal(10,2) NOT NULL DEFAULT '0.00',
  `updated_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

--
-- Dumping data for table `balances`
--

INSERT INTO `balances` (`uid`, `balance`, `total_used`, `updated_at`) VALUES
(3, 0.00, 0.00, '2025-02-10 23:15:58'),
(5, 0.00, 0.00, '2025-06-01 14:55:10');

-- --------------------------------------------------------

--
-- Table structure for table `devices`
--

CREATE TABLE `devices` (
  `id` int NOT NULL,
  `uid` int NOT NULL,
  `name` varchar(255) COLLATE utf8mb4_general_ci DEFAULT NULL,
  `phone` varchar(255) COLLATE utf8mb4_general_ci DEFAULT NULL,
  `status` enum('connecting','connected','disconnected','removed','error') COLLATE utf8mb4_general_ci DEFAULT 'connecting',
  `device_key` varchar(255) COLLATE utf8mb4_general_ci DEFAULT NULL,
  `packageId` varchar(30) COLLATE utf8mb4_general_ci DEFAULT NULL,
  `created_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

--
-- Dumping data for table `devices`
--

INSERT INTO `devices` (`id`, `uid`, `name`, `phone`, `status`, `device_key`, `packageId`, `created_at`, `updated_at`) VALUES
(5, 3, 'Presensi Edukasi', '6285179973381', 'connected', 'c6b6cc17', NULL, '2025-01-31 23:16:58', '2025-06-05 04:20:03'),
(11, 5, 'waMuhima', '085809024512', 'connecting', '678b1aa4', '1', '2025-06-01 15:04:57', '2025-06-01 15:04:57'),
(12, 3, 'JasaEdukasi', '085158891240', 'connecting', '1a793205', '1', '2025-06-04 10:26:30', '2025-06-04 10:26:30');

-- --------------------------------------------------------

--
-- Table structure for table `groups`
--

CREATE TABLE `groups` (
  `id` int NOT NULL,
  `group_id` varchar(255) COLLATE utf8mb4_general_ci NOT NULL,
  `name` varchar(255) COLLATE utf8mb4_general_ci NOT NULL,
  `did` int NOT NULL,
  `uid` int NOT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

-- --------------------------------------------------------

--
-- Table structure for table `logs`
--

CREATE TABLE `logs` (
  `id` int NOT NULL,
  `uid` int NOT NULL,
  `action` varchar(255) NOT NULL,
  `created_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=latin1;

-- --------------------------------------------------------

--
-- Table structure for table `messages`
--

CREATE TABLE `messages` (
  `id` int NOT NULL,
  `uid` int NOT NULL,
  `device_id` int NOT NULL,
  `number` varchar(30) COLLATE utf8mb4_general_ci DEFAULT NULL,
  `message` text COLLATE utf8mb4_general_ci,
  `type` enum('personal','bulk','group') COLLATE utf8mb4_general_ci NOT NULL,
  `role` varchar(30) COLLATE utf8mb4_general_ci DEFAULT NULL,
  `status` enum('pending','sent','failed','processing') COLLATE utf8mb4_general_ci DEFAULT 'pending',
  `response` text COLLATE utf8mb4_general_ci,
  `created_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` timestamp NULL DEFAULT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

-- --------------------------------------------------------

--
-- Table structure for table `packages`
--

CREATE TABLE `packages` (
  `id` int NOT NULL,
  `name` varchar(50) COLLATE utf8mb4_general_ci NOT NULL,
  `price` decimal(10,2) NOT NULL,
  `duration` int NOT NULL,
  `description` text COLLATE utf8mb4_general_ci,
  `recomended` int DEFAULT NULL,
  `created_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

--
-- Dumping data for table `packages`
--

INSERT INTO `packages` (`id`, `name`, `price`, `duration`, `description`, `recomended`, `created_at`, `updated_at`) VALUES
(1, 'Paket 1', 25000.00, 30, '✅Unlimited Pesan<br>\r\n✅Kirim personal<br>\r\n✅Kirim group<br>\r\n✅Pesan text<br>\r\n❌Pesan Blast<br>\r\n❌Pesan schedule<br>\r\n❌Pesan template (deprecated)<br>\r\n❌Pesan button (deprecated)<br>\r\n❌Pesan attachment<br>\r\n❌Autoreply<br>\r\n❌Webhook<br>\r\n✅API<br>\r\n✅Full Support 24/7', 0, '2025-02-08 21:11:28', '2025-02-10 14:02:05'),
(2, 'Paket 2', 50000.00, 30, '✅Unlimited Pesan<br>\r\n✅Kirim personal<br>\r\n✅Kirim group<br>\r\n✅Pesan text<br>\r\n✅Pesan Blast<br>\r\n✅Pesan schedule<br>\r\n✅Pesan template (deprecated)<br>\r\n✅Pesan button (deprecated)<br>\r\n✅Pesan attachment<br>\r\n✅Autoreply<br>\r\n✅Webhook<br>\r\n✅API<br>\r\n✅Full Support 24/7', 1, '2025-02-08 21:11:28', '2025-02-10 14:02:07'),
(3, 'Paket 3', 600000.00, 365, '✅Unlimited Pesan<br>\r\n✅Kirim personal<br>\r\n✅Kirim group<br>\r\n✅Pesan text<br>\r\n✅Pesan Blast<br>\r\n✅Pesan schedule<br>\r\n✅Pesan template (deprecated)<br>\r\n✅Pesan button (deprecated)<br>\r\n✅Pesan attachment<br>\r\n✅Autoreply<br>\r\n✅Webhook<br>\r\n✅API<br>\r\n✅Full Support 24/7', 0, '2025-02-08 21:11:28', '2025-02-10 16:35:57'),
(4, 'Paket 4', 300000.00, 365, '✅Unlimited Pesan<br>\r\n✅Kirim personal<br>\r\n✅Kirim group<br>\r\n✅Pesan text<br>\r\n❌Pesan Blast<br>\r\n❌Pesan schedule<br>\r\n❌Pesan template (deprecated)<br>\r\n❌Pesan button (deprecated)<br>\r\n❌Pesan attachment<br>\r\n❌Autoreply<br>\r\n❌Webhook<br>\r\n✅API<br>\r\n✅Full Support 24/7', 0, '2025-02-08 21:11:28', '2025-02-10 14:02:02');

-- --------------------------------------------------------

--
-- Table structure for table `settings`
--

CREATE TABLE `settings` (
  `id` int NOT NULL,
  `key_name` varchar(100) COLLATE utf8mb4_general_ci NOT NULL,
  `value` text COLLATE utf8mb4_general_ci NOT NULL,
  `created_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

-- --------------------------------------------------------

--
-- Table structure for table `transactions`
--

CREATE TABLE `transactions` (
  `id` int NOT NULL,
  `uid` int NOT NULL,
  `merchantOrderId` varchar(255) COLLATE utf8mb4_general_ci DEFAULT NULL,
  `paymentUrl` varchar(255) COLLATE utf8mb4_general_ci DEFAULT NULL,
  `reference` varchar(255) COLLATE utf8mb4_general_ci DEFAULT NULL,
  `description` varchar(255) COLLATE utf8mb4_general_ci NOT NULL,
  `amount` decimal(10,2) NOT NULL,
  `status` enum('success','pending','failed','paid') COLLATE utf8mb4_general_ci NOT NULL,
  `whatIs` enum('+','-') COLLATE utf8mb4_general_ci DEFAULT NULL,
  `created_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

-- --------------------------------------------------------

--
-- Table structure for table `users`
--

CREATE TABLE `users` (
  `uid` int NOT NULL,
  `name` varchar(60) COLLATE utf8mb4_general_ci DEFAULT NULL,
  `email` varchar(80) COLLATE utf8mb4_general_ci DEFAULT NULL,
  `phone` varchar(30) COLLATE utf8mb4_general_ci DEFAULT NULL,
  `username` varchar(60) COLLATE utf8mb4_general_ci DEFAULT NULL,
  `password` varchar(255) COLLATE utf8mb4_general_ci DEFAULT NULL,
  `api_key` varchar(255) COLLATE utf8mb4_general_ci NOT NULL,
  `active` int DEFAULT '0',
  `created_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

--
-- Dumping data for table `users`
--

INSERT INTO `users` (`uid`, `name`, `email`, `phone`, `username`, `password`, `api_key`, `active`, `created_at`) VALUES
(3, 'SMKN 1 Marga Sekampung', 'smkn1marse@gmail.com', '6285769641780', 'user1', '1234', '9b0a811f5d511d91b630a93ad882064b0ced925ffb46d188df920c339e824e82', 1, '2025-01-31 18:22:28'),
(5, 'SMK MUHAMMADIYAH 1 MARGA TIGA', 'smk1muhima@presensi.edu', '085809024512', NULL, '@12345678', '5016855e26c34715fbbd2d82f2e2b045', 1, '2025-06-01 14:45:16');

--
-- Indexes for dumped tables
--

--
-- Indexes for table `autoreply`
--
ALTER TABLE `autoreply`
  ADD PRIMARY KEY (`id`);

--
-- Indexes for table `balances`
--
ALTER TABLE `balances`
  ADD PRIMARY KEY (`uid`);

--
-- Indexes for table `devices`
--
ALTER TABLE `devices`
  ADD PRIMARY KEY (`id`),
  ADD KEY `user_id` (`uid`);

--
-- Indexes for table `groups`
--
ALTER TABLE `groups`
  ADD PRIMARY KEY (`id`);

--
-- Indexes for table `logs`
--
ALTER TABLE `logs`
  ADD PRIMARY KEY (`id`),
  ADD KEY `uid` (`uid`);

--
-- Indexes for table `messages`
--
ALTER TABLE `messages`
  ADD PRIMARY KEY (`id`),
  ADD KEY `device_id` (`device_id`);

--
-- Indexes for table `packages`
--
ALTER TABLE `packages`
  ADD PRIMARY KEY (`id`);

--
-- Indexes for table `settings`
--
ALTER TABLE `settings`
  ADD PRIMARY KEY (`id`),
  ADD UNIQUE KEY `key_name` (`key_name`);

--
-- Indexes for table `transactions`
--
ALTER TABLE `transactions`
  ADD PRIMARY KEY (`id`);

--
-- Indexes for table `users`
--
ALTER TABLE `users`
  ADD PRIMARY KEY (`uid`),
  ADD UNIQUE KEY `api_key` (`api_key`);

--
-- AUTO_INCREMENT for dumped tables
--

--
-- AUTO_INCREMENT for table `autoreply`
--
ALTER TABLE `autoreply`
  MODIFY `id` int NOT NULL AUTO_INCREMENT, AUTO_INCREMENT=6;

--
-- AUTO_INCREMENT for table `devices`
--
ALTER TABLE `devices`
  MODIFY `id` int NOT NULL AUTO_INCREMENT, AUTO_INCREMENT=13;

--
-- AUTO_INCREMENT for table `groups`
--
ALTER TABLE `groups`
  MODIFY `id` int NOT NULL AUTO_INCREMENT;

--
-- AUTO_INCREMENT for table `logs`
--
ALTER TABLE `logs`
  MODIFY `id` int NOT NULL AUTO_INCREMENT;

--
-- AUTO_INCREMENT for table `messages`
--
ALTER TABLE `messages`
  MODIFY `id` int NOT NULL AUTO_INCREMENT, AUTO_INCREMENT=7;

--
-- AUTO_INCREMENT for table `packages`
--
ALTER TABLE `packages`
  MODIFY `id` int NOT NULL AUTO_INCREMENT, AUTO_INCREMENT=5;

--
-- AUTO_INCREMENT for table `settings`
--
ALTER TABLE `settings`
  MODIFY `id` int NOT NULL AUTO_INCREMENT;

--
-- AUTO_INCREMENT for table `transactions`
--
ALTER TABLE `transactions`
  MODIFY `id` int NOT NULL AUTO_INCREMENT;

--
-- AUTO_INCREMENT for table `users`
--
ALTER TABLE `users`
  MODIFY `uid` int NOT NULL AUTO_INCREMENT, AUTO_INCREMENT=6;

--
-- Constraints for dumped tables
--

--
-- Constraints for table `logs`
--
ALTER TABLE `logs`
  ADD CONSTRAINT `logs_ibfk_1` FOREIGN KEY (`uid`) REFERENCES `users` (`uid`) ON DELETE CASCADE;
COMMIT;

/*!40101 SET CHARACTER_SET_CLIENT=@OLD_CHARACTER_SET_CLIENT */;
/*!40101 SET CHARACTER_SET_RESULTS=@OLD_CHARACTER_SET_RESULTS */;
/*!40101 SET COLLATION_CONNECTION=@OLD_COLLATION_CONNECTION */;
