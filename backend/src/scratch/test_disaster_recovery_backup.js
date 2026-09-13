/**
 * Unit Test: Disaster Recovery, Automated SQLite VACUUM Backup & Crash State Recovery
 * Menjamin database dapat dibackup secara online tanpa lock dan state siaran dapat dipulihkan pasca crash.
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const sqliteManager = require('../db/sqlite-manager');
const retentionController = require('../core/retention-controller');

async function runTest() {
  console.log('--- START TEST: Disaster Recovery, Online Backup & Crash State Recovery ---');

  const testBackupDir = path.join(__dirname, 'test_backups');
  if (!fs.existsSync(testBackupDir)) {
    fs.mkdirSync(testBackupDir, { recursive: true });
  }

  const testBackupFile = path.join(testBackupDir, `test_backup_${Date.now()}.db`);
  const testCampaignId = `cmp-crash-test-${Date.now()}`;

  try {
    // 1. Online Atomic SQLite Backup (VACUUM INTO)
    console.log('[1] Verifikasi Automated Online SQLite Snapshot (VACUUM INTO)...');
    const backupRes = sqliteManager.createAutomatedBackup(testBackupFile);
    assert.strictEqual(backupRes.success, true, 'createAutomatedBackup harus berhasil');
    assert(fs.existsSync(testBackupFile), 'File backup database harus ada di disk');
    const stat = fs.statSync(testBackupFile);
    assert(stat.size > 1000, `Ukuran backup database (${stat.size} bytes) harus valid`);
    console.log(`    Backup berhasil dibuat secara non-blocking: ${testBackupFile} (${stat.size} bytes)`);

    // 2. Backup Retention Clean Rotation
    console.log('[2] Verifikasi Backup Retention Rotation...');
    // Buat dummy old file berusia 10 hari
    const oldFile = path.join(testBackupDir, 'old_backup_2026-01-01.db');
    fs.writeFileSync(oldFile, 'dummy old backup content', 'utf8');
    const oldTime = Date.now() - (10 * 24 * 60 * 60 * 1000);
    fs.utimesSync(oldFile, oldTime / 1000, oldTime / 1000);

    const deleted = sqliteManager.cleanOldBackups(testBackupDir, 7);
    assert.strictEqual(deleted, 1, 'File backup berusia > 7 hari harus dihapus otomatis');
    assert(!fs.existsSync(oldFile), 'File lama harus sudah terhapus');
    console.log('    ✅ PASS: Rotasi retensi backup 7 hari berhasil menghapus file usang.');

    // 3. Active Campaign State Recovery on Crash
    console.log('[3] Verifikasi Active Campaign State Tracking & Recovery...');
    const statePayload = {
      id: testCampaignId,
      roomId: '88776655',
      targetViewers: 150,
      retentionMode: 'organic_curve',
      status: 'RUNNING',
      config: {
        roomId: '88776655',
        targetViewers: 150,
        retentionMode: 'organic_curve'
      },
      startedAt: new Date().toISOString()
    };

    sqliteManager.saveActiveCampaignState(statePayload);
    const activeStates = sqliteManager.getActiveCampaignStates();
    const foundState = activeStates.find(s => s.id === testCampaignId);
    assert(foundState, 'State siaran aktif harus tersimpan di tabel active_campaigns_state');
    assert.strictEqual(foundState.roomId, '88776655');
    assert.strictEqual(foundState.targetViewers, 150);
    assert.strictEqual(foundState.retentionMode, 'organic_curve');

    const interruptedList = retentionController.getInterruptedCampaigns();
    assert(interruptedList.some(s => s.id === testCampaignId), 'retentionController harus mendeteksi sesi yang belum selesai');
    console.log('    State Sesi Aktif Berhasil Dicatat:', { id: foundState.id, room: foundState.roomId, target: foundState.targetViewers });

    // Hapus state setelah dipulihkan / selesai
    sqliteManager.clearActiveCampaignState(testCampaignId);
    const postStates = sqliteManager.getActiveCampaignStates();
    assert(!postStates.some(s => s.id === testCampaignId), 'State harus terhapus setelah dibersihkan');
    console.log('    ✅ PASS: Crash auto-resume state tracking terverifikasi 100% konsisten.');

  } finally {
    // 4. Cleanup test directory
    console.log('[4] Membersihkan file pengujian...');
    sqliteManager.clearActiveCampaignState(testCampaignId);
    if (fs.existsSync(testBackupFile)) fs.unlinkSync(testBackupFile);
    if (fs.existsSync(testBackupDir)) {
      const files = fs.readdirSync(testBackupDir);
      for (const f of files) fs.unlinkSync(path.join(testBackupDir, f));
      fs.rmdirSync(testBackupDir);
    }
    console.log('    ✅ CLEANUP: Zero test file leftovers verified.');
  }

  console.log('🎉 ALL DISASTER RECOVERY & BACKUP TESTS PASSED (100% OK)');
}

runTest().then(() => {
  process.exit(0);
}).catch((err) => {
  console.error('❌ TEST FAILED:', err);
  process.exit(1);
});
