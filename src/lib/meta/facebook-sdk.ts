/**
 * Carga el Facebook JS SDK oficial (script, sin paquete npm).
 * Solo para el wizard cliente.
 */

export type FacebookLoginResponse = {
  status?: string;
  authResponse?: { code?: string } | null;
};

export type FacebookSDK = {
  init: (opts: {
    appId: string;
    cookie?: boolean;
    xfbml?: boolean;
    version: string;
  }) => void;
  login: (
    cb: (response: FacebookLoginResponse) => void,
    opts: Record<string, unknown>
  ) => void;
};

declare global {
  interface Window {
    FB?: FacebookSDK;
    fbAsyncInit?: () => void;
  }
}

const SDK_SRC = "https://connect.facebook.net/en_US/sdk.js";

export function loadFacebookSdk(): Promise<FacebookSDK> {
  if (typeof window === "undefined") {
    return Promise.reject(new Error("El SDK de Meta solo corre en el navegador"));
  }
  if (window.FB) return Promise.resolve(window.FB);

  return new Promise((resolve, reject) => {
    const previous = window.fbAsyncInit;
    window.fbAsyncInit = () => {
      previous?.();
      if (window.FB) resolve(window.FB);
      else reject(new Error("El SDK de Meta cargó sin FB"));
    };

    if (document.getElementById("facebook-jssdk")) {
      if (window.FB) resolve(window.FB);
      return;
    }

    const script = document.createElement("script");
    script.id = "facebook-jssdk";
    script.src = SDK_SRC;
    script.async = true;
    script.defer = true;
    script.onerror = () =>
      reject(new Error("No se pudo cargar el SDK de Meta"));
    document.body.appendChild(script);
  });
}
