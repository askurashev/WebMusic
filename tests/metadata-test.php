<?php
// Isolated binary fixtures; never writes to the user's music or backups.
declare(strict_types=1);
$dir = sys_get_temp_dir() . '/webmusic-tags-' . bin2hex(random_bytes(8));
mkdir($dir);
copy(dirname(__DIR__) . '/music.metadata.php', $dir . '/music.metadata.php');
require $dir . '/music.metadata.php';
$checks = 0;
function verify(bool $ok, string $message): void {
    global $checks;
    if (!$ok) throw new RuntimeException($message);
    $checks++; echo "PASS $message\n";
}
function removeFixture(string $dir): void {
    foreach (array_diff(scandir($dir), ['.', '..']) as $name) {
        $path = $dir . '/' . $name;
        if (is_dir($path)) removeFixture($path); else unlink($path);
    }
    rmdir($dir);
}
try {
    $audio = str_repeat("\xff\xfb\x90\x64" . str_repeat("\0", 413), 8);
    foreach ([2, 3, 4] as $v) {
        $frame = function(string $id, string $value) use ($v): string {
            return $id . mfpTagSize(strlen($value), $v === 4, $v === 2 ? 3 : 4) . ($v === 2 ? '' : "\0\0") . $value;
        };
        $cover = $frame($v === 2 ? 'PIC' : 'APIC', "\0image/jpeg\0\3\0" . random_bytes(200));
        $other = $frame($v === 2 ? 'TAL' : 'TALB', "\0Unchanged album");
        $unknown = $frame($v === 2 ? 'XYZ' : 'XABC', random_bytes(40));
        $display = $frame($v === 2 ? 'TYE' : ($v === 4 ? 'TDRL' : 'TYER'), "\0" . '2021') . $frame($v === 2 ? 'TLE' : 'TLEN', "\0" . '222000');
        $body = $cover . $other . $unknown . $display . $frame($v === 2 ? 'TT2' : 'TIT2', "\0Old title");
        $path = $dir . '/Песня.mp3';
        $original = 'ID3' . chr($v) . "\0\0" . mfpTagSize(strlen($body)) . $body . $audio;
        file_put_contents($path, $original);
        $tags = ['artist'=>'Певец & <script>', 'albumArtist'=>'Группа', 'title'=>'Новая песня 🎵'];
        $result = mfpSaveTags($path, $tags, mfpMetadata($path)['revision']);
        verify($result['tags'] === $tags, "ID3v2.$v Unicode round trip");
        verify($result['details'] === ['duration' => 222.0, 'year' => '2021'], "ID3v2.$v reads duration and year without changing editable fields");
        verify(str_contains(file_get_contents($path), $display), "ID3v2.$v preserves duration and year frames");
        $bytes = file_get_contents($path);
        verify(str_contains($bytes, $cover) && str_contains($bytes, $other) && str_contains($bytes, $unknown), "ID3v2.$v preserves cover, album, unknown frames byte for byte");
        verify(substr($bytes, mfpReadTags($path)['offset']) === $audio, "ID3v2.$v audio identical");
        $empty = ['artist'=>'', 'albumArtist'=>'', 'title'=>''];
        verify(mfpSaveTags($path, $empty, $result['revision'])['tags'] === $empty, "ID3v2.$v clears fields");
    }
    $v1 = 'TAG' . str_pad('Legacy title', 30, "\0") . str_pad('Legacy artist', 30, "\0") . str_repeat("\0", 30) . '1998' . str_repeat("\0", 31);
    file_put_contents($path, $audio . $v1);
    verify(mfpMetadata($path)['tags']['title'] === 'Legacy title', 'ID3v1 fallback');
    verify(mfpMetadata($path)['details']['year'] === '1998', 'ID3v1 year fallback');
    verify(abs(mfpMetadata($path)['details']['duration'] - 8 * 1152 / 44100) < 0.00001, 'duration from MPEG samples when TLEN is absent');
    $vbr = $audio . str_repeat("\xff\xfb\xa0\x64" . str_repeat("\0", 518), 5);
    $vbrPath = $dir . '/vbr.mp3'; file_put_contents($vbrPath, $vbr);
    verify(abs(mfpMetadata($vbrPath)['details']['duration'] - 13 * 1152 / 44100) < 0.00001, 'duration counts variable bitrate frames correctly');
    verify(mfpMetadata($vbrPath)['details']['year'] === null, 'missing year stays unknown');

    $result = mfpSaveTags($path, ['artist'=>'New', 'albumArtist'=>'Band', 'title'=>'Title'], mfpMetadata($path)['revision']);
    verify(substr(file_get_contents($path), -125, 5) === 'Title', 'ID3v1 title synchronized');
    verify(substr(file_get_contents($path), mfpReadTags($path)['offset'], strlen($audio)) === $audio, 'ID3v1 audio preserved');
    foreach (["ID3\3\0\x80\0\0\0\0", "ID3\4\0\0\0\0\x01\x00short"] as $bad) {
        file_put_contents($path, $bad . $audio);
        try { mfpSaveTags($path, $empty, hash_file('sha256', $path)); verify(false, 'should reject unsupported tag'); }
        catch (RuntimeException $e) { verify(file_get_contents($path) === $bad . $audio, 'unsupported or malformed tag leaves original intact'); }
    }
    echo "$checks metadata assertions passed.\n";
} finally { removeFixture($dir); }
