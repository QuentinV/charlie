export function pcmToWav(
    pcmBuffer,
    sampleRate = 16000,
    numChannels = 1,
    bitsPerSample = 16
) {
    const byteRate = (sampleRate * numChannels * bitsPerSample) / 8;
    const blockAlign = (numChannels * bitsPerSample) / 8;
    const header = Buffer.alloc(44);

    header.write('RIFF', 0);
    header.writeUInt32LE(36 + pcmBuffer.length, 4);
    header.write('WAVE', 8);
    header.write('fmt ', 12);
    header.writeUInt32LE(16, 16);
    header.writeUInt16LE(1, 20);
    header.writeUInt16LE(numChannels, 22);
    header.writeUInt32LE(sampleRate, 24);
    header.writeUInt32LE(byteRate, 28);
    header.writeUInt16LE(blockAlign, 32);
    header.writeUInt16LE(bitsPerSample, 34);
    header.write('data', 36);
    header.writeUInt32LE(pcmBuffer.length, 40);

    return Buffer.concat([header, pcmBuffer]);
}

export function wavToPcm(wavBuffer) {
    if (wavBuffer.length < 44) {
        throw new Error('Invalid WAV file: too small');
    }

    if (wavBuffer.toString('ascii', 0, 4) !== 'RIFF') {
        throw new Error('Invalid WAV file: missing RIFF');
    }

    if (wavBuffer.toString('ascii', 8, 12) !== 'WAVE') {
        throw new Error('Invalid WAV file: missing WAVE');
    }

    const audioFormat = wavBuffer.readUInt16LE(20);
    if (audioFormat !== 1) {
        throw new Error('Unsupported WAV format: not PCM');
    }

    const bitsPerSample = wavBuffer.readUInt16LE(34);
    if (bitsPerSample !== 16) {
        throw new Error('Unsupported WAV bit depth: expected 16-bit');
    }

    // Find "data" chunk (not always at 44 bytes if WAV has extra chunks)
    let offset = 12;
    let dataStart = -1;
    let dataSize = -1;

    while (offset < wavBuffer.length) {
        const chunkId = wavBuffer.toString('ascii', offset, offset + 4);
        const chunkSize = wavBuffer.readUInt32LE(offset + 4);

        if (chunkId === 'data') {
            dataStart = offset + 8;
            dataSize = chunkSize;
            break;
        }

        offset += 8 + chunkSize;
    }

    if (dataStart === -1) {
        throw new Error('Invalid WAV file: missing data chunk');
    }

    return wavBuffer.slice(dataStart, dataStart + dataSize);
}
