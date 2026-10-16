/** Join a video-only MP4 and an audio-only MP4 into one file, without re-encoding. */

const MAX_OUTPUT_BYTES = 700_000_000

type Box = {
  type: string
  header: number
  start: number
  end: number
}

type Sample = {
  duration: number
  size: number
  offset: number
  keyframe: boolean
  cto: number
}

type Prepared = {
  handler: "vide" | "soun"
  timescale: number
  language: number
  width: number
  height: number
  stsd: Uint8Array
  samples: Sample[]
  source: Uint8Array
}

type Trex = {
  duration: number
  size: number
  flags: number
}

type Run = {
  count: number
  value: number
}

export function isIsoBmff(bytes: Uint8Array): boolean {
  return bytes.byteLength > 12 && ascii(bytes, 4, 4) === "ftyp"
}

export function muxAvcAac(video: Uint8Array, audio: Uint8Array): Uint8Array {
  if (!isIsoBmff(video) || !isIsoBmff(audio)) throw new Error("media")
  const picture = extract(video, "vide")
  const sound = extract(audio, "soun")
  if (!picture || !sound) throw new Error("media")
  const payload = sampleBytes(picture) + sampleBytes(sound)
  if (payload <= 0 || payload > MAX_OUTPUT_BYTES) throw new Error("media")
  const moov = new Bin()
  writeMoov(moov, picture, sound)
  const moovBytes = moov.finish()
  const ftyp = ftypBytes()
  const total = ftyp.length + moovBytes.length + 8 + payload
  if (total > MAX_OUTPUT_BYTES) throw new Error("media")
  const out = new Uint8Array(total)
  out.set(ftyp, 0)
  out.set(moovBytes, ftyp.length)
  const mdat = ftyp.length + moovBytes.length
  putU32(out, mdat, 8 + payload)
  out.set(typeBytes("mdat"), mdat + 4)
  let cursor = mdat + 8
  const videoAt = cursor
  cursor = copySamples(out, cursor, picture)
  const audioAt = cursor
  copySamples(out, cursor, sound)
  putU32(out, ftyp.length + moov.marks.video, videoAt)
  putU32(out, ftyp.length + moov.marks.audio, audioAt)
  return out
}

/** Sound track from a video or audio MP4, written as a standalone M4A file. */
export function audioOnlyFile(bytes: Uint8Array): Uint8Array {
  if (!isIsoBmff(bytes)) throw new Error("media")
  const sound = extract(bytes, "soun")
  if (!sound) throw new Error("media")
  const payload = sampleBytes(sound)
  if (payload <= 0 || payload > MAX_OUTPUT_BYTES) throw new Error("media")
  const moov = new Bin()
  writeAudioMoov(moov, sound)
  const moovBytes = moov.finish()
  const ftyp = m4aFtypBytes()
  const total = ftyp.length + moovBytes.length + 8 + payload
  if (total > MAX_OUTPUT_BYTES) throw new Error("media")
  const out = new Uint8Array(total)
  out.set(ftyp, 0)
  out.set(moovBytes, ftyp.length)
  const mdat = ftyp.length + moovBytes.length
  putU32(out, mdat, 8 + payload)
  out.set(typeBytes("mdat"), mdat + 4)
  const audioAt = mdat + 8
  copySamples(out, audioAt, sound)
  putU32(out, ftyp.length + moov.marks.audio, audioAt)
  return out
}

function writeAudioMoov(bin: Bin, audio: Prepared): void {
  const root = openBox(bin, "moov")
  writeMvhd(bin, movieUnits(audio))
  writeTrak(bin, audio, 1, movieUnits(audio), "audio")
  closeBox(bin, root)
}

class Bin {
  private data = new Uint8Array(4096)
  length = 0
  marks = { video: 0, audio: 0 }

  private grow(extra: number): void {
    if (this.length + extra <= this.data.length) return
    let size = this.data.length
    while (size < this.length + extra) size *= 2
    const next = new Uint8Array(size)
    next.set(this.data.subarray(0, this.length), 0)
    this.data = next
  }

  u8(value: number): void {
    this.grow(1)
    this.data[this.length] = value & 0xff
    this.length += 1
  }

  u16(value: number): void {
    this.grow(2)
    this.data[this.length] = (value >> 8) & 0xff
    this.data[this.length + 1] = value & 0xff
    this.length += 2
  }

  u32(value: number): void {
    this.grow(4)
    putU32(this.data, this.length, value)
    this.length += 4
  }

  u64(value: number): void {
    const hi = Math.floor(value / 4294967296)
    const lo = value - hi * 4294967296
    this.u32(hi)
    this.u32(lo)
  }

  text(value: string): void {
    this.grow(value.length)
    for (let index = 0; index < value.length; index += 1) this.data[this.length + index] = value.charCodeAt(index) & 0xff
    this.length += value.length
  }

  bytes(value: Uint8Array): void {
    this.grow(value.length)
    this.data.set(value, this.length)
    this.length += value.length
  }

  patchU32(offset: number, value: number): void {
    putU32(this.data, offset, value)
  }

  finish(): Uint8Array {
    return this.data.slice(0, this.length)
  }
}

function writeMoov(bin: Bin, video: Prepared, audio: Prepared): void {
  const movie = Math.max(movieUnits(video), movieUnits(audio))
  const root = openBox(bin, "moov")
  writeMvhd(bin, movie)
  writeTrak(bin, video, 1, movie, "video")
  writeTrak(bin, audio, 2, movie, "audio")
  closeBox(bin, root)
}

function writeMvhd(bin: Bin, duration: number): void {
  const start = openBox(bin, "mvhd")
  bin.u32(0)
  bin.u32(0)
  bin.u32(0)
  bin.u32(1000)
  bin.u32(duration)
  bin.u32(0x00010000)
  bin.u16(0x0100)
  bin.u16(0)
  bin.u32(0)
  bin.u32(0)
  writeMatrix(bin)
  for (let index = 0; index < 6; index += 1) bin.u32(0)
  bin.u32(3)
  closeBox(bin, start)
}

function writeTrak(bin: Bin, track: Prepared, id: number, movieDuration: number, mark: "video" | "audio"): void {
  const root = openBox(bin, "trak")
  writeTkhd(bin, track, id, movieDuration)
  const mdia = openBox(bin, "mdia")
  writeMdhd(bin, track)
  writeHdlr(bin, track.handler)
  const minf = openBox(bin, "minf")
  if (track.handler === "vide") writeVmhd(bin)
  else writeSmhd(bin)
  writeDinf(bin)
  const stbl = openBox(bin, "stbl")
  bin.bytes(track.stsd)
  writeStts(bin, track.samples)
  writeStss(bin, track)
  writeCtts(bin, track.samples)
  writeStsc(bin, track.samples.length)
  writeStsz(bin, track.samples)
  writeStco(bin, mark)
  closeBox(bin, stbl)
  closeBox(bin, minf)
  closeBox(bin, mdia)
  closeBox(bin, root)
}

function writeTkhd(bin: Bin, track: Prepared, id: number, duration: number): void {
  const start = openBox(bin, "tkhd")
  bin.u32(7)
  bin.u32(0)
  bin.u32(0)
  bin.u32(id)
  bin.u32(0)
  bin.u32(duration)
  bin.u32(0)
  bin.u32(0)
  bin.u16(0)
  bin.u16(0)
  bin.u16(track.handler === "soun" ? 0x0100 : 0)
  bin.u16(0)
  writeMatrix(bin)
  bin.u32(track.handler === "vide" ? track.width : 0)
  bin.u32(track.handler === "vide" ? track.height : 0)
  closeBox(bin, start)
}

function writeMdhd(bin: Bin, track: Prepared): void {
  const ticks = totalTicks(track.samples)
  const start = openBox(bin, "mdhd")
  if (ticks > 0xffffffff) {
    bin.u32(0x01000000)
    bin.u64(0)
    bin.u64(0)
    bin.u32(track.timescale)
    bin.u64(ticks)
  } else {
    bin.u32(0)
    bin.u32(0)
    bin.u32(0)
    bin.u32(track.timescale)
    bin.u32(ticks)
  }
  bin.u16(track.language)
  bin.u16(0)
  closeBox(bin, start)
}

function writeHdlr(bin: Bin, handler: "vide" | "soun"): void {
  const start = openBox(bin, "hdlr")
  bin.u32(0)
  bin.u32(0)
  bin.text(handler)
  bin.u32(0)
  bin.u32(0)
  bin.u32(0)
  bin.text(handler === "vide" ? "VideoHandler\0" : "SoundHandler\0")
  closeBox(bin, start)
}

function writeVmhd(bin: Bin): void {
  const start = openBox(bin, "vmhd")
  bin.u32(1)
  bin.u16(0)
  bin.u16(0)
  bin.u16(0)
  bin.u16(0)
  closeBox(bin, start)
}

function writeSmhd(bin: Bin): void {
  const start = openBox(bin, "smhd")
  bin.u32(0)
  bin.u16(0)
  bin.u16(0)
  closeBox(bin, start)
}

function writeDinf(bin: Bin): void {
  const dinf = openBox(bin, "dinf")
  const dref = openBox(bin, "dref")
  bin.u32(0)
  bin.u32(1)
  const url = openBox(bin, "url ")
  bin.u32(1)
  closeBox(bin, url)
  closeBox(bin, dref)
  closeBox(bin, dinf)
}

function writeStts(bin: Bin, samples: Sample[]): void {
  const start = openBox(bin, "stts")
  const list = runs(samples, "duration")
  bin.u32(0)
  bin.u32(list.length)
  for (const run of list) {
    bin.u32(run.count)
    bin.u32(run.value >>> 0)
  }
  closeBox(bin, start)
}

function writeStss(bin: Bin, track: Prepared): void {
  if (track.handler !== "vide") return
  const keys: number[] = []
  track.samples.forEach((sample, index) => {
    if (sample.keyframe) keys.push(index + 1)
  })
  if (!keys.length) keys.push(1)
  if (keys.length === track.samples.length) return
  const start = openBox(bin, "stss")
  bin.u32(0)
  bin.u32(keys.length)
  for (const key of keys) bin.u32(key)
  closeBox(bin, start)
}

function writeCtts(bin: Bin, samples: Sample[]): void {
  if (samples.every((sample) => sample.cto === 0)) return
  const list = runs(samples, "cto")
  const version = samples.some((sample) => sample.cto < 0) ? 1 : 0
  const start = openBox(bin, "ctts")
  bin.u32(version === 1 ? 0x01000000 : 0)
  bin.u32(list.length)
  for (const run of list) {
    bin.u32(run.count)
    bin.u32(run.value >>> 0)
  }
  closeBox(bin, start)
}

function writeStsc(bin: Bin, count: number): void {
  const start = openBox(bin, "stsc")
  bin.u32(0)
  bin.u32(1)
  bin.u32(1)
  bin.u32(count)
  bin.u32(1)
  closeBox(bin, start)
}

function writeStsz(bin: Bin, samples: Sample[]): void {
  const start = openBox(bin, "stsz")
  bin.u32(0)
  bin.u32(0)
  bin.u32(samples.length)
  for (const sample of samples) bin.u32(sample.size)
  closeBox(bin, start)
}

function writeStco(bin: Bin, mark: "video" | "audio"): void {
  const start = openBox(bin, "stco")
  bin.u32(0)
  bin.u32(1)
  bin.marks[mark] = bin.length
  bin.u32(0)
  closeBox(bin, start)
}

function writeMatrix(bin: Bin): void {
  for (const value of [0x00010000, 0, 0, 0, 0x00010000, 0, 0, 0, 0x40000000]) bin.u32(value)
}

function openBox(bin: Bin, type: string): number {
  const start = bin.length
  bin.u32(0)
  bin.text(type)
  return start
}

function closeBox(bin: Bin, start: number): void {
  bin.patchU32(start, bin.length - start)
}

function extract(data: Uint8Array, handler: "vide" | "soun"): Prepared | null {
  const top = boxes(data, 0, data.length)
  const moov = top.find((box) => box.type === "moov")
  if (!moov) return null
  const defaults = readTrex(data, moov)
  let best: Prepared | null = null
  let bestBytes = -1
  for (const trak of children(data, moov)) {
    if (trak.type !== "trak" || handlerOf(data, trak) !== handler) continue
    const prepared = readTrak(data, trak, top, defaults, handler)
    if (!prepared) continue
    const bytes = sampleBytes(prepared)
    if (bytes > bestBytes) {
      best = prepared
      bestBytes = bytes
    }
  }
  return best
}

function readTrak(
  data: Uint8Array,
  trak: Box,
  top: Box[],
  defaults: Map<number, Trex>,
  handler: "vide" | "soun"
): Prepared | null {
  const mdia = child(data, trak, "mdia")
  const minf = mdia ? child(data, mdia, "minf") : null
  const stbl = minf ? child(data, minf, "stbl") : null
  const stsdBox = stbl ? child(data, stbl, "stsd") : null
  const mdhd = mdia ? child(data, mdia, "mdhd") : null
  const tkhd = child(data, trak, "tkhd")
  if (!stbl || !stsdBox || !mdhd || !tkhd) return null
  const timing = readMdhd(data, mdhd)
  if (!timing) return null
  const trackId = readTrackId(data, tkhd)
  const table = readTable(data, stbl)
  const fragments = readFragments(data, top, trackId, defaults.get(trackId) ?? null)
  const samples = fragments.length > table.length ? fragments : table
  if (!samples.length) return null
  for (const sample of samples) {
    if (sample.size < 0 || sample.offset < 0 || sample.offset + sample.size > data.length) return null
  }
  const visual = visualSize(data.subarray(stsdBox.start, stsdBox.end))
  const fixed = readDimensions(data, tkhd)
  return {
    handler,
    timescale: timing.timescale,
    language: timing.language,
    width: fixed.width || (visual.width << 16),
    height: fixed.height || (visual.height << 16),
    stsd: data.slice(stsdBox.start, stsdBox.end),
    samples,
    source: data
  }
}

function readTable(data: Uint8Array, stbl: Box): Sample[] {
  const stts = child(data, stbl, "stts")
  const stsz = child(data, stbl, "stsz")
  const stsc = child(data, stbl, "stsc")
  const stco = child(data, stbl, "stco") || child(data, stbl, "co64")
  if (!stts || !stsz || !stsc || !stco) return []
  const durations = readStts(data, stts)
  const sizes = readStsz(data, stsz)
  const chunks = readChunks(data, stsc, stco)
  const sync = readStss(data, child(data, stbl, "stss"))
  const shifts = readCtts(data, child(data, stbl, "ctts"))
  const samples: Sample[] = []
  let index = 0
  for (const chunk of chunks) {
    let offset = chunk.offset
    for (let count = 0; count < chunk.samples && index < sizes.length; count += 1) {
      const size = sizes[index]
      samples.push({
        duration: durations[index] ?? durations[durations.length - 1] ?? 0,
        size,
        offset,
        keyframe: sync ? sync.has(index + 1) : true,
        cto: shifts[index] ?? 0
      })
      offset += size
      index += 1
    }
  }
  return samples
}

function readFragments(data: Uint8Array, top: Box[], trackId: number, trex: Trex | null): Sample[] {
  const samples: Sample[] = []
  for (const moof of top) {
    if (moof.type !== "moof") continue
    for (const traf of children(data, moof)) {
      if (traf.type !== "traf") continue
      const parts = children(data, traf)
      const tfhdBox = parts.find((box) => box.type === "tfhd")
      if (!tfhdBox) continue
      const tfhd = readTfhd(data, tfhdBox)
      if (!tfhd || tfhd.trackId !== trackId) continue
      const base = tfhd.baseDataOffset ?? moof.start
      const mdat = top.find((box) => box.type === "mdat" && box.start >= moof.end)
      for (const trunBox of parts) {
        if (trunBox.type !== "trun") continue
        const trun = readTrun(data, trunBox)
        if (!trun) continue
        let cursor = trun.dataOffset == null ? (mdat ? mdat.start + mdat.header : base) : base + trun.dataOffset
        trun.samples.forEach((sample, index) => {
          const flags =
            sample.flags ??
            (index === 0 && trun.firstFlags != null ? trun.firstFlags : tfhd.defaultFlags ?? trex?.flags ?? 0)
          const size = sample.size ?? tfhd.defaultSize ?? trex?.size ?? 0
          const duration = sample.duration ?? tfhd.defaultDuration ?? trex?.duration ?? 0
          samples.push({
            duration,
            size,
            offset: cursor,
            keyframe: (flags & 0x10000) === 0,
            cto: sample.cto ?? 0
          })
          cursor += size
        })
      }
    }
  }
  return samples
}

function readTfhd(data: Uint8Array, box: Box): { trackId: number; baseDataOffset?: number; defaultDuration?: number; defaultSize?: number; defaultFlags?: number } | null {
  const view = viewOf(data)
  let cursor = box.start + box.header
  if (cursor + 8 > box.end) return null
  const flags = view.getUint32(cursor) & 0xffffff
  cursor += 4
  const trackId = view.getUint32(cursor)
  cursor += 4
  let baseDataOffset: number | undefined
  if (flags & 0x1) {
    if (cursor + 8 > box.end) return null
    const hi = view.getUint32(cursor)
    const lo = view.getUint32(cursor + 4)
    if (hi > 0) return null
    baseDataOffset = lo
    cursor += 8
  }
  if (flags & 0x2) cursor += 4
  let defaultDuration: number | undefined
  let defaultSize: number | undefined
  let defaultFlags: number | undefined
  if (flags & 0x8) {
    if (cursor + 4 > box.end) return null
    defaultDuration = view.getUint32(cursor)
    cursor += 4
  }
  if (flags & 0x10) {
    if (cursor + 4 > box.end) return null
    defaultSize = view.getUint32(cursor)
    cursor += 4
  }
  if (flags & 0x20) {
    if (cursor + 4 > box.end) return null
    defaultFlags = view.getUint32(cursor)
  }
  return { trackId, baseDataOffset, defaultDuration, defaultSize, defaultFlags }
}

type TrunSample = { duration?: number; size?: number; flags?: number; cto?: number }

function readTrun(data: Uint8Array, box: Box): { dataOffset?: number; firstFlags?: number; samples: TrunSample[] } | null {
  const view = viewOf(data)
  let cursor = box.start + box.header
  if (cursor + 8 > box.end) return null
  const version = data[cursor]
  const flags = view.getUint32(cursor) & 0xffffff
  cursor += 4
  const count = view.getUint32(cursor)
  cursor += 4
  if (count > 5_000_000) return null
  let dataOffset: number | undefined
  let firstFlags: number | undefined
  if (flags & 0x1) {
    if (cursor + 4 > box.end) return null
    dataOffset = view.getInt32(cursor)
    cursor += 4
  }
  if (flags & 0x4) {
    if (cursor + 4 > box.end) return null
    firstFlags = view.getUint32(cursor)
    cursor += 4
  }
  const samples: TrunSample[] = []
  for (let index = 0; index < count; index += 1) {
    const sample: TrunSample = {}
    if (flags & 0x100) {
      if (cursor + 4 > box.end) return null
      sample.duration = view.getUint32(cursor)
      cursor += 4
    }
    if (flags & 0x200) {
      if (cursor + 4 > box.end) return null
      sample.size = view.getUint32(cursor)
      cursor += 4
    }
    if (flags & 0x400) {
      if (cursor + 4 > box.end) return null
      sample.flags = view.getUint32(cursor)
      cursor += 4
    }
    if (flags & 0x800) {
      if (cursor + 4 > box.end) return null
      sample.cto = version === 0 ? view.getUint32(cursor) : view.getInt32(cursor)
      cursor += 4
    }
    samples.push(sample)
  }
  return { dataOffset, firstFlags, samples }
}

function readTrex(data: Uint8Array, moov: Box): Map<number, Trex> {
  const found = new Map<number, Trex>()
  const mvex = child(data, moov, "mvex")
  if (!mvex) return found
  const view = viewOf(data)
  for (const box of children(data, mvex)) {
    if (box.type !== "trex") continue
    const cursor = box.start + box.header
    if (cursor + 24 > box.end) continue
    found.set(view.getUint32(cursor + 4), {
      duration: view.getUint32(cursor + 12),
      size: view.getUint32(cursor + 16),
      flags: view.getUint32(cursor + 20)
    })
  }
  return found
}

function readStts(data: Uint8Array, box: Box): number[] {
  const view = viewOf(data)
  const cursor = box.start + box.header
  if (cursor + 8 > box.end) return []
  const count = view.getUint32(cursor + 4)
  const durations: number[] = []
  let offset = cursor + 8
  for (let index = 0; index < count && offset + 8 <= box.end; index += 1) {
    const repeat = view.getUint32(offset)
    const duration = view.getUint32(offset + 4)
    offset += 8
    for (let time = 0; time < repeat && durations.length < 5_000_000; time += 1) durations.push(duration)
  }
  return durations
}

function readStsz(data: Uint8Array, box: Box): number[] {
  const view = viewOf(data)
  const cursor = box.start + box.header
  if (cursor + 12 > box.end) return []
  const fixed = view.getUint32(cursor + 4)
  const count = view.getUint32(cursor + 8)
  if (count > 5_000_000) return []
  if (fixed) return Array.from({ length: count }, () => fixed)
  const sizes: number[] = []
  let offset = cursor + 12
  for (let index = 0; index < count && offset + 4 <= box.end; index += 1) {
    sizes.push(view.getUint32(offset))
    offset += 4
  }
  return sizes
}

function readChunks(data: Uint8Array, stsc: Box, stco: Box): { offset: number; samples: number }[] {
  const view = viewOf(data)
  const sc = stsc.start + stsc.header
  if (sc + 8 > stsc.end) return []
  const entries: { first: number; samples: number }[] = []
  const entryCount = view.getUint32(sc + 4)
  let cursor = sc + 8
  for (let index = 0; index < entryCount && cursor + 12 <= stsc.end; index += 1) {
    entries.push({ first: view.getUint32(cursor), samples: view.getUint32(cursor + 4) })
    cursor += 12
  }
  const wide = stco.type === "co64"
  const co = stco.start + stco.header
  if (co + 8 > stco.end) return []
  const count = view.getUint32(co + 4)
  const chunks: { offset: number; samples: number }[] = []
  cursor = co + 8
  for (let index = 0; index < count; index += 1) {
    if (wide) {
      if (cursor + 8 > stco.end) break
      if (view.getUint32(cursor) > 0) return []
      const offset = view.getUint32(cursor + 4)
      cursor += 8
      chunks.push({ offset, samples: samplesInChunk(entries, index + 1) })
    } else {
      if (cursor + 4 > stco.end) break
      const offset = view.getUint32(cursor)
      cursor += 4
      chunks.push({ offset, samples: samplesInChunk(entries, index + 1) })
    }
  }
  return chunks
}

function samplesInChunk(entries: { first: number; samples: number }[], chunk: number): number {
  let samples = entries[0]?.samples ?? 0
  for (const entry of entries) {
    if (entry.first > chunk) break
    samples = entry.samples
  }
  return samples
}

function readStss(data: Uint8Array, box: Box | null): Set<number> | null {
  if (!box) return null
  const view = viewOf(data)
  const cursor = box.start + box.header
  if (cursor + 8 > box.end) return new Set()
  const count = view.getUint32(cursor + 4)
  const sync = new Set<number>()
  let offset = cursor + 8
  for (let index = 0; index < count && offset + 4 <= box.end; index += 1) {
    sync.add(view.getUint32(offset))
    offset += 4
  }
  return sync
}

function readCtts(data: Uint8Array, box: Box | null): number[] {
  if (!box) return []
  const view = viewOf(data)
  const cursor = box.start + box.header
  if (cursor + 8 > box.end) return []
  const version = data[cursor]
  const count = view.getUint32(cursor + 4)
  const shifts: number[] = []
  let offset = cursor + 8
  for (let index = 0; index < count && offset + 8 <= box.end; index += 1) {
    const repeat = view.getUint32(offset)
    const value = version === 0 ? view.getUint32(offset + 4) : view.getInt32(offset + 4)
    offset += 8
    for (let time = 0; time < repeat && shifts.length < 5_000_000; time += 1) shifts.push(value)
  }
  return shifts
}

function readMdhd(data: Uint8Array, box: Box): { timescale: number; language: number } | null {
  const view = viewOf(data)
  const cursor = box.start + box.header
  if (cursor + 4 > box.end) return null
  const version = data[cursor]
  if (version === 1) {
    if (cursor + 34 > box.end) return null
    const timescale = view.getUint32(cursor + 20)
    if (!timescale) return null
    return { timescale, language: view.getUint16(cursor + 32) }
  }
  if (cursor + 22 > box.end) return null
  const timescale = view.getUint32(cursor + 12)
  if (!timescale) return null
  return { timescale, language: view.getUint16(cursor + 20) }
}

function readTrackId(data: Uint8Array, box: Box): number {
  const view = viewOf(data)
  const cursor = box.start + box.header
  const version = data[cursor] ?? 0
  const offset = version === 1 ? 20 : 12
  if (cursor + offset + 4 > box.end) return 0
  return view.getUint32(cursor + offset)
}

function readDimensions(data: Uint8Array, box: Box): { width: number; height: number } {
  if (box.end - box.start < 16) return { width: 0, height: 0 }
  const view = viewOf(data)
  return { width: view.getUint32(box.end - 8), height: view.getUint32(box.end - 4) }
}

function visualSize(stsd: Uint8Array): { width: number; height: number } {
  if (stsd.length < 52) return { width: 0, height: 0 }
  return { width: (stsd[48] << 8) | stsd[49], height: (stsd[50] << 8) | stsd[51] }
}

function handlerOf(data: Uint8Array, trak: Box): string {
  const mdia = child(data, trak, "mdia")
  const hdlr = mdia ? child(data, mdia, "hdlr") : null
  if (!hdlr) return ""
  const offset = hdlr.start + hdlr.header + 8
  if (offset + 4 > hdlr.end) return ""
  return ascii(data, offset, 4)
}

function boxes(data: Uint8Array, start: number, end: number): Box[] {
  const view = viewOf(data)
  const found: Box[] = []
  let cursor = start
  while (cursor + 8 <= end) {
    const small = view.getUint32(cursor)
    const type = ascii(data, cursor + 4, 4)
    let size = small
    let header = 8
    if (small === 1) {
      if (cursor + 16 > end || view.getUint32(cursor + 8) > 0) break
      size = view.getUint32(cursor + 12)
      header = 16
    } else if (small === 0) {
      size = end - cursor
    }
    if (size < header || cursor + size > end) break
    found.push({ type, header, start: cursor, end: cursor + size })
    cursor += size
  }
  return found
}

function children(data: Uint8Array, box: Box): Box[] {
  return boxes(data, box.start + box.header, box.end)
}

function child(data: Uint8Array, box: Box, type: string): Box | null {
  return children(data, box).find((item) => item.type === type) ?? null
}

function sampleBytes(track: Prepared): number {
  let total = 0
  for (const sample of track.samples) total += sample.size
  return total
}

function totalTicks(samples: Sample[]): number {
  let total = 0
  for (const sample of samples) total += sample.duration
  return total
}

function movieUnits(track: Prepared): number {
  if (track.timescale <= 0) return 0
  return Math.max(0, Math.round((totalTicks(track.samples) / track.timescale) * 1000))
}

function runs(samples: Sample[], field: "duration" | "cto"): Run[] {
  const list: Run[] = []
  for (const sample of samples) {
    const value = sample[field]
    const last = list[list.length - 1]
    if (last && last.value === value) last.count += 1
    else list.push({ count: 1, value })
  }
  return list
}

function copySamples(out: Uint8Array, start: number, track: Prepared): number {
  let cursor = start
  for (const sample of track.samples) {
    out.set(track.source.subarray(sample.offset, sample.offset + sample.size), cursor)
    cursor += sample.size
  }
  return cursor
}

function ftypBytes(): Uint8Array {
  const bin = new Bin()
  const start = openBox(bin, "ftyp")
  bin.text("isom")
  bin.u32(0x200)
  bin.text("isom")
  bin.text("iso2")
  bin.text("avc1")
  bin.text("mp41")
  closeBox(bin, start)
  return bin.finish()
}

function m4aFtypBytes(): Uint8Array {
  const bin = new Bin()
  const start = openBox(bin, "ftyp")
  bin.text("M4A ")
  bin.u32(0)
  bin.text("M4A ")
  bin.text("mp42")
  bin.text("isom")
  closeBox(bin, start)
  return bin.finish()
}

function putU32(data: Uint8Array, offset: number, value: number): void {
  data[offset] = (value >>> 24) & 0xff
  data[offset + 1] = (value >>> 16) & 0xff
  data[offset + 2] = (value >>> 8) & 0xff
  data[offset + 3] = value & 0xff
}

function typeBytes(type: string): Uint8Array {
  return Uint8Array.from(type, (char) => char.charCodeAt(0))
}

function ascii(data: Uint8Array, offset: number, length: number): string {
  let text = ""
  for (let index = 0; index < length; index += 1) text += String.fromCharCode(data[offset + index])
  return text
}

function viewOf(data: Uint8Array): DataView {
  return new DataView(data.buffer, data.byteOffset, data.byteLength)
}

function concatenated(track: Prepared): Uint8Array {
  const out = new Uint8Array(sampleBytes(track))
  let cursor = 0
  for (const sample of track.samples) {
    out.set(track.source.subarray(sample.offset, sample.offset + sample.size), cursor)
    cursor += sample.size
  }
  return out
}

function sameBytes(left: Uint8Array, right: Uint8Array): boolean {
  if (left.length !== right.length) return false
  for (let index = 0; index < left.length; index += 1) if (left[index] !== right[index]) return false
  return true
}

/** Builds tiny tracks and checks the joiner keeps picture and sound bytes. */
export function mp4MuxSelfCheck(): string[] {
  const errors: string[] = []
  const picture = Uint8Array.from([1, 2, 3, 4, 5, 6, 7, 8])
  const sound = Uint8Array.from([9, 8, 7, 6, 5])
  const plainVideo = plainFixture("vide", 1, picture, 1000, 40)
  const plainAudio = plainFixture("soun", 2, sound, 48000, 1024)
  const fragVideo = fragmentedFixture(picture)
  const plainRead = extract(plainVideo, "vide")
  const audioRead = extract(plainAudio, "soun")
  const fragRead = extract(fragVideo, "vide")
  if (!plainRead || !sameBytes(concatenated(plainRead), picture)) errors.push("plain video")
  if (!audioRead || !sameBytes(concatenated(audioRead), sound)) errors.push("plain audio")
  if (!fragRead || !sameBytes(concatenated(fragRead), picture)) errors.push("fragmented video")
  try {
    const joined = muxAvcAac(fragVideo, plainAudio)
    const joinedVideo = extract(joined, "vide")
    const joinedAudio = extract(joined, "soun")
    if (!isIsoBmff(joined)) errors.push("joined type")
    if (!joinedVideo || !sameBytes(concatenated(joinedVideo), picture)) errors.push("joined video")
    if (!joinedAudio || !sameBytes(concatenated(joinedAudio), sound)) errors.push("joined audio")
    if (!joinedVideo?.samples.some((sample) => sample.keyframe)) errors.push("keyframe")
    const audioFile = audioOnlyFile(joined)
    const audioBack = extract(audioFile, "soun")
    if (!isIsoBmff(audioFile) || ascii(audioFile, 8, 4) !== "M4A ") errors.push("audio brand")
    if (!audioBack || !sameBytes(concatenated(audioBack), sound)) errors.push("audio file")
    if (extract(audioFile, "vide")) errors.push("audio kept video")
    const bare = audioOnlyFile(plainAudio)
    const bareBack = extract(bare, "soun")
    if (!bareBack || !sameBytes(concatenated(bareBack), sound)) errors.push("bare audio")
  } catch {
    errors.push("mux threw")
  }
  return errors
}

function plainFixture(handler: "vide" | "soun", trackId: number, payload: Uint8Array, timescale: number, duration: number): Uint8Array {
  const bin = new Bin()
  const ftyp = openBox(bin, "ftyp")
  bin.text("isom")
  bin.u32(0)
  closeBox(bin, ftyp)
  const moov = openBox(bin, "moov")
  const mvhd = openBox(bin, "mvhd")
  bin.u32(0)
  bin.u32(0)
  bin.u32(0)
  bin.u32(1000)
  bin.u32(1000)
  bin.u32(0x00010000)
  bin.u16(0x0100)
  bin.u16(0)
  bin.u32(0)
  bin.u32(0)
  writeMatrix(bin)
  for (let index = 0; index < 6; index += 1) bin.u32(0)
  bin.u32(2)
  closeBox(bin, mvhd)
  const trak = openBox(bin, "trak")
  const tkhd = openBox(bin, "tkhd")
  bin.u32(7)
  bin.u32(0)
  bin.u32(0)
  bin.u32(trackId)
  bin.u32(0)
  bin.u32(1000)
  bin.u32(0)
  bin.u32(0)
  bin.u16(0)
  bin.u16(0)
  bin.u16(handler === "soun" ? 0x0100 : 0)
  bin.u16(0)
  writeMatrix(bin)
  bin.u32(handler === "vide" ? 640 << 16 : 0)
  bin.u32(handler === "vide" ? 360 << 16 : 0)
  closeBox(bin, tkhd)
  const mdia = openBox(bin, "mdia")
  const mdhd = openBox(bin, "mdhd")
  bin.u32(0)
  bin.u32(0)
  bin.u32(0)
  bin.u32(timescale)
  bin.u32(duration)
  bin.u16(0x55c4)
  bin.u16(0)
  closeBox(bin, mdhd)
  writeHdlr(bin, handler)
  const minf = openBox(bin, "minf")
  if (handler === "vide") writeVmhd(bin)
  else writeSmhd(bin)
  writeDinf(bin)
  const stbl = openBox(bin, "stbl")
  writeFixtureStsd(bin, handler)
  const stts = openBox(bin, "stts")
  bin.u32(0)
  bin.u32(1)
  bin.u32(1)
  bin.u32(duration)
  closeBox(bin, stts)
  const stsc = openBox(bin, "stsc")
  bin.u32(0)
  bin.u32(1)
  bin.u32(1)
  bin.u32(1)
  bin.u32(1)
  closeBox(bin, stsc)
  const stsz = openBox(bin, "stsz")
  bin.u32(0)
  bin.u32(payload.length)
  bin.u32(1)
  closeBox(bin, stsz)
  const stco = openBox(bin, "stco")
  bin.u32(0)
  bin.u32(1)
  const offsetAt = bin.length
  bin.u32(0)
  closeBox(bin, stco)
  closeBox(bin, stbl)
  closeBox(bin, minf)
  closeBox(bin, mdia)
  closeBox(bin, trak)
  closeBox(bin, moov)
  const mdat = openBox(bin, "mdat")
  const payloadAt = bin.length
  bin.bytes(payload)
  closeBox(bin, mdat)
  bin.patchU32(offsetAt, payloadAt)
  return bin.finish()
}

function fragmentedFixture(payload: Uint8Array): Uint8Array {
  const bin = new Bin()
  const ftyp = openBox(bin, "ftyp")
  bin.text("isom")
  bin.u32(0)
  closeBox(bin, ftyp)
  const moov = openBox(bin, "moov")
  const mvhd = openBox(bin, "mvhd")
  bin.u32(0)
  bin.u32(0)
  bin.u32(0)
  bin.u32(1000)
  bin.u32(0)
  bin.u32(0x00010000)
  bin.u16(0x0100)
  bin.u16(0)
  bin.u32(0)
  bin.u32(0)
  writeMatrix(bin)
  for (let index = 0; index < 6; index += 1) bin.u32(0)
  bin.u32(2)
  closeBox(bin, mvhd)
  const trak = openBox(bin, "trak")
  const tkhd = openBox(bin, "tkhd")
  bin.u32(7)
  bin.u32(0)
  bin.u32(0)
  bin.u32(1)
  bin.u32(0)
  bin.u32(0)
  bin.u32(0)
  bin.u32(0)
  bin.u16(0)
  bin.u16(0)
  bin.u16(0)
  bin.u16(0)
  writeMatrix(bin)
  bin.u32(320 << 16)
  bin.u32(240 << 16)
  closeBox(bin, tkhd)
  const mdia = openBox(bin, "mdia")
  const mdhd = openBox(bin, "mdhd")
  bin.u32(0)
  bin.u32(0)
  bin.u32(0)
  bin.u32(1000)
  bin.u32(0)
  bin.u16(0x55c4)
  bin.u16(0)
  closeBox(bin, mdhd)
  writeHdlr(bin, "vide")
  const minf = openBox(bin, "minf")
  writeVmhd(bin)
  writeDinf(bin)
  const stbl = openBox(bin, "stbl")
  writeFixtureStsd(bin, "vide")
  const stts = openBox(bin, "stts")
  bin.u32(0)
  bin.u32(0)
  closeBox(bin, stts)
  const stsc = openBox(bin, "stsc")
  bin.u32(0)
  bin.u32(0)
  closeBox(bin, stsc)
  const stsz = openBox(bin, "stsz")
  bin.u32(0)
  bin.u32(0)
  bin.u32(0)
  closeBox(bin, stsz)
  const stco = openBox(bin, "stco")
  bin.u32(0)
  bin.u32(0)
  closeBox(bin, stco)
  closeBox(bin, stbl)
  closeBox(bin, minf)
  closeBox(bin, mdia)
  closeBox(bin, trak)
  const mvex = openBox(bin, "mvex")
  const trex = openBox(bin, "trex")
  bin.u32(0)
  bin.u32(1)
  bin.u32(1)
  bin.u32(1000)
  bin.u32(payload.length)
  bin.u32(0x01010000)
  closeBox(bin, trex)
  closeBox(bin, mvex)
  closeBox(bin, moov)
  const moofAt = openBox(bin, "moof")
  const mfhd = openBox(bin, "mfhd")
  bin.u32(0)
  bin.u32(1)
  closeBox(bin, mfhd)
  const traf = openBox(bin, "traf")
  const tfhd = openBox(bin, "tfhd")
  bin.u32(0x020000)
  bin.u32(1)
  closeBox(bin, tfhd)
  const trun = openBox(bin, "trun")
  bin.u32(0x000001 | 0x000004 | 0x000200)
  bin.u32(1)
  const dataOffsetAt = bin.length
  bin.u32(0)
  bin.u32(0x02000000)
  bin.u32(payload.length)
  closeBox(bin, trun)
  closeBox(bin, traf)
  closeBox(bin, moofAt)
  const mdat = openBox(bin, "mdat")
  const payloadAt = bin.length
  bin.bytes(payload)
  closeBox(bin, mdat)
  bin.patchU32(dataOffsetAt, payloadAt - moofAt)
  return bin.finish()
}

function writeFixtureStsd(bin: Bin, handler: "vide" | "soun"): void {
  const stsd = openBox(bin, "stsd")
  bin.u32(0)
  bin.u32(1)
  const entry = openBox(bin, handler === "vide" ? "avc1" : "mp4a")
  for (let index = 0; index < 6; index += 1) bin.u8(0)
  bin.u16(1)
  if (handler === "vide") {
    for (let index = 0; index < 16; index += 1) bin.u8(0)
    bin.u16(64)
    bin.u16(64)
    for (let index = 0; index < 50; index += 1) bin.u8(0)
  } else {
    for (let index = 0; index < 8; index += 1) bin.u8(0)
    bin.u16(2)
    bin.u16(16)
    bin.u32(0)
    bin.u16(0)
  }
  closeBox(bin, entry)
  closeBox(bin, stsd)
}
