"""
Юнит-тесты для локального файлового хранилища (app.utils.local_storage).

Не требуют новых зависимостей - используют только стандартный unittest.
Запуск:
    python -m unittest tests.test_local_storage -v
"""
import io
import os
import shutil
import tempfile
import unittest
from unittest import mock

from app.utils.local_storage import (
    FileMetadata,
    LocalStorageService,
    safe_filename,
)
from app.utils.storage_exceptions import (
    DiskUnavailableError,
    FileNotFoundInStorageError,
    InsufficientSpaceError,
    InvalidPathError,
)


class LocalStorageServiceTestBase(unittest.TestCase):
    def setUp(self):
        self.tmp_dirs = [tempfile.mkdtemp(prefix="storage_disk_") for _ in range(2)]

    def tearDown(self):
        for d in self.tmp_dirs:
            shutil.rmtree(d, ignore_errors=True)


class TestSaveAndReadFile(LocalStorageServiceTestBase):
    def test_save_file_creates_file_on_disk(self):
        service = LocalStorageService(disks=[self.tmp_dirs[0]])
        content = b"hello world"
        metadata = service.save_file(io.BytesIO(content), "news/pic.jpg", original_filename="pic.jpg")

        self.assertEqual(metadata.disk_id, "disk0")
        self.assertEqual(metadata.relative_path, "news/pic.jpg")
        self.assertEqual(metadata.size, len(content))
        full_path = os.path.join(self.tmp_dirs[0], "news", "pic.jpg")
        self.assertTrue(os.path.isfile(full_path))
        with open(full_path, "rb") as f:
            self.assertEqual(f.read(), content)

    def test_read_file_returns_saved_content(self):
        service = LocalStorageService(disks=[self.tmp_dirs[0]])
        content = b"some binary data \x00\x01"
        metadata = service.save_file(io.BytesIO(content), "users/avatar.bin")

        self.assertEqual(service.read_file(metadata), content)

    def test_read_file_missing_raises_not_found(self):
        service = LocalStorageService(disks=[self.tmp_dirs[0]])
        missing = FileMetadata(disk_id="disk0", relative_path="missing/file.txt")
        with self.assertRaises(FileNotFoundInStorageError):
            service.read_file(missing)

    def test_get_file_stream_yields_full_content(self):
        service = LocalStorageService(disks=[self.tmp_dirs[0]])
        content = os.urandom(200_000)
        metadata = service.save_file(io.BytesIO(content), "chat/video.mp4")

        chunks = list(service.get_file_stream(metadata, chunk_size=1024))
        self.assertEqual(b"".join(chunks), content)

    def test_exists(self):
        service = LocalStorageService(disks=[self.tmp_dirs[0]])
        metadata = service.save_file(io.BytesIO(b"x"), "news/a.jpg")
        self.assertTrue(service.exists(metadata))
        self.assertFalse(service.exists(FileMetadata(disk_id="disk0", relative_path="news/missing.jpg")))


class TestDeleteFile(LocalStorageServiceTestBase):
    def test_delete_file_removes_it(self):
        service = LocalStorageService(disks=[self.tmp_dirs[0]])
        metadata = service.save_file(io.BytesIO(b"to be deleted"), "news/del.jpg")
        self.assertTrue(service.exists(metadata))

        deleted = service.delete_file(metadata)
        self.assertTrue(deleted)
        self.assertFalse(service.exists(metadata))

    def test_delete_missing_file_returns_false(self):
        service = LocalStorageService(disks=[self.tmp_dirs[0]])
        missing = FileMetadata(disk_id="disk0", relative_path="nope.jpg")
        self.assertFalse(service.delete_file(missing))


class TestPathTraversalProtection(LocalStorageServiceTestBase):
    def setUp(self):
        super().setUp()
        self.service = LocalStorageService(disks=[self.tmp_dirs[0]])

    def test_save_file_rejects_dot_dot_traversal(self):
        with self.assertRaises(InvalidPathError):
            self.service.save_file(io.BytesIO(b"x"), "../../etc/passwd")

    def test_save_file_rejects_absolute_unix_path(self):
        with self.assertRaises(InvalidPathError):
            self.service.save_file(io.BytesIO(b"x"), "/etc/passwd")

    def test_save_file_rejects_absolute_windows_path(self):
        with self.assertRaises(InvalidPathError):
            self.service.save_file(io.BytesIO(b"x"), "C:/Windows/System32/config")

    def test_read_file_rejects_traversal_in_metadata(self):
        malicious = FileMetadata(disk_id="disk0", relative_path="../outside.txt")
        with self.assertRaises(FileNotFoundInStorageError):
            self.service.read_file(malicious)

    def test_safe_filename_strips_path_components(self):
        self.assertEqual(safe_filename("../../etc/passwd"), "passwd")
        self.assertEqual(safe_filename("..\\..\\windows\\win.ini"), "win.ini")
        self.assertNotIn("/", safe_filename("some/weird name!@#.jpg"))


class TestDiskSelection(LocalStorageServiceTestBase):
    def test_first_available_strategy_uses_first_writable_disk(self):
        service = LocalStorageService(disks=self.tmp_dirs, strategy="first_available")
        metadata = service.save_file(io.BytesIO(b"x"), "news/a.jpg")
        self.assertEqual(metadata.disk_id, "disk0")

    def test_first_available_skips_unavailable_disk(self):
        service = LocalStorageService(disks=self.tmp_dirs, strategy="first_available")
        with mock.patch.object(service, "_is_disk_available", side_effect=lambda p: p != self.tmp_dirs[0]):
            metadata = service.save_file(io.BytesIO(b"x"), "news/a.jpg")
        self.assertEqual(metadata.disk_id, "disk1")

    def test_round_robin_distributes_across_disks(self):
        service = LocalStorageService(disks=self.tmp_dirs, strategy="round_robin")
        disk_ids = [
            service.save_file(io.BytesIO(b"x"), f"news/{i}.jpg").disk_id
            for i in range(4)
        ]
        self.assertEqual(set(disk_ids), {"disk0", "disk1"})

    def test_most_free_space_strategy_picks_disk_with_more_space(self):
        service = LocalStorageService(disks=self.tmp_dirs, strategy="most_free_space")
        free_values = {self.tmp_dirs[0]: 1_000, self.tmp_dirs[1]: 1_000_000}
        with mock.patch.object(service, "_free_bytes", side_effect=lambda p: free_values[p]):
            metadata = service.save_file(io.BytesIO(b"x"), "news/a.jpg")
        self.assertEqual(metadata.disk_id, "disk1")

    def test_all_disks_unavailable_raises(self):
        service = LocalStorageService(disks=self.tmp_dirs, strategy="first_available")
        with mock.patch.object(service, "_is_disk_available", return_value=False):
            with self.assertRaises(DiskUnavailableError):
                service.save_file(io.BytesIO(b"x"), "news/a.jpg")

    def test_insufficient_space_on_all_disks_raises(self):
        service = LocalStorageService(disks=self.tmp_dirs, strategy="first_available")
        with mock.patch.object(service, "_free_bytes", return_value=10):
            with self.assertRaises(InsufficientSpaceError):
                service.save_file(io.BytesIO(b"x"), "news/a.jpg", min_free_bytes=10_000_000)


class TestFallbackSearch(LocalStorageServiceTestBase):
    def test_find_by_relative_path_locates_file_on_second_disk(self):
        service = LocalStorageService(disks=self.tmp_dirs, strategy="round_robin")
        # Кладём файл напрямую на второй диск, минуя save_file, чтобы смоделировать
        # ситуацию "файл есть, но его diskId неизвестен вызывающей стороне".
        os.makedirs(os.path.join(self.tmp_dirs[1], "news"), exist_ok=True)
        with open(os.path.join(self.tmp_dirs[1], "news", "orphan.jpg"), "wb") as f:
            f.write(b"orphan content")

        found = service.find_by_relative_path("news/orphan.jpg")
        self.assertIsNotNone(found)
        self.assertEqual(found.disk_id, "disk1")

    def test_read_file_with_fallback_finds_file_on_other_disk(self):
        service = LocalStorageService(disks=self.tmp_dirs, strategy="round_robin")
        os.makedirs(os.path.join(self.tmp_dirs[1], "news"), exist_ok=True)
        with open(os.path.join(self.tmp_dirs[1], "news", "orphan.jpg"), "wb") as f:
            f.write(b"orphan content")

        wrong_guess = FileMetadata(disk_id="disk0", relative_path="news/orphan.jpg")
        content = service.read_file(wrong_guess, fallback=True)
        self.assertEqual(content, b"orphan content")


if __name__ == "__main__":
    unittest.main()
