import type { DemoResourceSlot, PaymentInstructions } from "./resources";

/** Solo tipos para cliente; nunca importa el validador node:net al navegador. */
export type VideoResourceDto = {
  slot: DemoResourceSlot;
  configured: boolean;
  media: null | {
    assetId: string;
    fileName: string;
    fileSize: number;
    mimeType: string;
    previewUrl: string;
  };
};
export type CommercialResourcesDto = {
  videos: VideoResourceDto[];
  paymentInstructions: PaymentInstructions;
};
