// [INPUT]: 已认证解密流、Zstandard 和旧版 gzip 魔数。
// [OUTPUT]: 新归档的快速 Zstd 编码器及兼容旧归档的有界窗口解码器。
// [POS]: 压缩格式适配层，不改变外层 BAGAID01 的认证和密钥协议。
// [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
use std::io::{self, BufRead, BufReader, Read, Write};
pub fn encode<W: Write>(output: W) -> io::Result<zstd::stream::write::Encoder<'static, W>> {
    let mut encoder = zstd::stream::write::Encoder::new(output, 3)?;
    encoder.include_checksum(true)?;
    Ok(encoder)
}
pub fn decode<R: Read + 'static>(input: R) -> io::Result<Box<dyn Read>> {
    let mut buffered = BufReader::new(input);
    let magic = buffered.fill_buf()?;
    if magic.starts_with(&[0x1f, 0x8b]) {
        return Ok(Box::new(flate2::read::MultiGzDecoder::new(buffered)));
    }
    if !magic.starts_with(&[0x28, 0xb5, 0x2f, 0xfd]) {
        return Err(io::Error::new(
            io::ErrorKind::InvalidData,
            "身份压缩格式无效。",
        ));
    }
    let mut decoder = zstd::stream::read::Decoder::with_buffer(buffered)?;
    decoder.window_log_max(27)?;
    Ok(Box::new(decoder))
}
