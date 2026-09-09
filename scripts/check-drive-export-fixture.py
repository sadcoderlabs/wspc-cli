"""Generate and independently verify a bounded-memory tar fixture."""
import hashlib
import json
import sys
import tarfile

mode, path, size = sys.argv[1], sys.argv[2], int(sys.argv[3])
body_size = size - 1536
chunk = b"wspc-export-fixture\n" * 32768
expected = hashlib.sha256()
remaining = body_size
if mode == "create":
    with open(path, "xb") as output:
        entry = tarfile.TarInfo("fixture/payload.bin")
        entry.size = body_size
        output.write(entry.tobuf(format=tarfile.USTAR_FORMAT))
        while remaining:
            part = chunk[:min(remaining, len(chunk))]
            output.write(part)
            expected.update(part)
            remaining -= len(part)
        output.write(bytes(1024))
else:
    while remaining:
        part = chunk[:min(remaining, len(chunk))]
        expected.update(part)
        remaining -= len(part)
    with tarfile.open(path, mode="r|") as archive:
        entry = next(iter(archive))
        assert entry.name == "fixture/payload.bin"
        assert entry.size == body_size
        actual = hashlib.sha256()
        content = archive.extractfile(entry)
        while part := content.read(1024 * 1024):
            actual.update(part)
        assert actual.digest() == expected.digest()
        assert archive.next() is None
with open(path, "rb") as source:
    archive_digest = hashlib.sha256()
    while part := source.read(1024 * 1024):
        archive_digest.update(part)
    archive_hash = archive_digest.hexdigest()
print(json.dumps({"path": "fixture/payload.bin", "bytes": body_size, "sha256": expected.hexdigest(), "tar_sha256": archive_hash}))
