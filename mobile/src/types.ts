export interface SearchResult {
  id: number;
  date: string;
  text: string;
  file_name: string;
  size: number;
  size_str: string;
  channel_id: number;
  channel_name: string;
  downloaded: boolean;
  clean_name?: string;
  media_type?: string;
  season?: number;
  episode?: number;
  tags?: string[];
  tmdb_id?: number;
  tmdb_type?: string;
  tmdb_valid?: boolean;
  /** Ruta en el servidor si ya esta descargado (segun la tabla de descargas). */
  local_path?: string | null;
  owner?: string | null;
  can_delete?: boolean;
  tmdb_title?: string;
  tmdb_year?: number;
  tmdb_rating?: number;
  tmdb_poster?: string;
  tmdb_backdrop?: string;
  tmdb_overview?: string;
  tmdb_genres?: string[];
}

export interface Channel {
  id: number;
  name: string;
}

export interface Dialog {
  id: number;
  name: string;
  is_channel: boolean;
  is_group: boolean;
  is_megagroup: boolean;
  active: boolean;
}

export interface BatchPart {
  message_id: number;
  file_name: string;
  part_num: number;
  size: number;
  size_str: string;
  downloaded: number;
  progress: number;
  status: string;
  error?: string;
}

export interface Batch {
  batch_id: string;
  base_name: string;
  folder_name: string;
  folder_path: string;
  parts: BatchPart[];
  total_parts: number;
  downloaded_parts: number;
  total_size: number;
  total_size_str: string;
  downloaded_size: number;
  /** Lo descargado y la velocidad, tal y como los manda el servidor: los
   *  calcula el con los bytes exactos (ver download_router). */
  downloaded_size_str?: string;
  speed_str?: string;
  /** Lo que queda ("6 min"); vacio si no se puede estimar. */
  eta_str?: string;
  progress: number;
  status: string;
  extracted_files: string[];
  error: string | null;
  /** Cuenta que la pidio. */
  owner?: string;
}

export interface FileItem {
  name: string;
  is_dir: boolean;
  size: string;
  path: string;
  is_series?: boolean;
  clean_name?: string;
  episodes?: SeriesEpisode[];
  /** Peliculas: siempre al menos una. Varias = 4K y 1080p del mismo titulo. */
  versions?: MovieVersion[];
  owner?: string;
  can_delete?: boolean;
}

/** Una version de una pelicula en disco: el mismo titulo en otra calidad. */
export interface MovieVersion {
  name: string;
  size: string;
  size_bytes: number;
  path: string;
  /** "1080p", "2160p HDR"... vacio si el nombre no dice nada. */
  quality: string;
  owner?: string;
  can_delete?: boolean;
}

export interface SeriesEpisode {
  name: string;
  size: string;
  path: string;
  message_id?: number;
  channel_id?: number;
}

export interface TMDBMetadata {
  title: string;
  /** Lo devuelve /metadata/batch: sirve para abrir la ficha desde el disco. */
  tmdb_id?: number;
  year?: number;
  rating?: number;
  poster?: string;
  backdrop?: string;
  overview?: string;
  media_type?: string;
  genres?: string[];
}

export interface AppConfig {
  api_id: number;
  api_hash: string;
  phone: string;
  channels: Channel[];
  download_path: string;
  extract_path: string;
  server_host: string;
  server_port: number;
  delete_archives_after_extract: boolean;
  download_parallel: number;
  convert_dts_to_ac3: boolean;
  stream_max?: number;
}

export interface DownloadState {
  messageId: number;
  batchId: string;
  progress: number;
  status: 'downloading' | 'extracting' | 'converting' | 'done' | 'error';
  downloadedStr?: string;
  totalStr?: string;
  /** Velocidad y tiempo restante, ya en texto. Antes se calculaba aqui
   *  deshaciendo la cadena de lo descargado ("1.2 GB" -> bytes), y a esa
   *  escala la resolucion es de 100 MB: el numero salia a saltos o en blanco.
   *  Los bytes exactos los tiene el servidor, asi que los manda el. */
  speedStr?: string;
  etaStr?: string;
}

export interface IndexChannelStatus {
  channel_id: number;
  channel_name: string;
  total_indexed: number;
  total_estimate: number;
  total_scanned: number;
  status: string;
  phase: string;
}

export interface BrowseItem {
  id: string;
  tmdb_id: number;
  title: string;
  poster?: string;
  backdrop?: string;
  year?: number;
  rating?: number;
  overview?: string;
  media_type: 'movie' | 'series';
  episode_count?: number;
  file_count?: number;
  genres?: string[];
  channel_id?: number;
  channel_name?: string;
  message_id?: number;
}

export interface BrowseRow {
  genre: string;
  items: BrowseItem[];
  /** Cuantos titulos hay en total en esta fila (no cuantos han llegado). */
  total?: number;
  /** El genero con el que se piden mas paginas; null si la fila no se pagina. */
  key?: string | null;
}
