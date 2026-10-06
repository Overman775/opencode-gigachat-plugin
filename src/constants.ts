import * as path from "path";
import * as os from "os";

export const GIGACHAT_OAUTH_URL = "https://ngw.devices.sberbank.ru:9443/api/v2/oauth";
export const GIGACHAT_API_URL = "https://api.giga.chat/v1";
export const GIGACHAT_COMPLETIONS_URL = `${GIGACHAT_API_URL}/chat/completions`;
export const GIGACHAT_FILES_URL = `${GIGACHAT_API_URL}/files`;

export const CONFIG_DIR = path.join(os.homedir(), ".config", "opencode");

export const DEFAULT_CA_BUNDLE_FILE = path.join(CONFIG_DIR, "certs", "russian_trusted_root_ca.pem");

export const REFRESH_BUFFER_SECONDS = 300; // 5 minutes

export const ERROR_CODES = {
  BAD_REQUEST: 400,
  UNAUTHORIZED: 401,
  FORBIDDEN: 403,
  PAYLOAD_TOO_LARGE: 413,
  UNPROCESSABLE: 422,
  RATE_LIMITED: 429,
  SERVER_ERROR: 500,
  SERVICE_UNAVAILABLE: 503
};
