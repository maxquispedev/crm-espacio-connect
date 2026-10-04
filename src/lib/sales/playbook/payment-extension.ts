import type { Config, ConfigV11 } from "./schema";
import { JEV_SALES_QUESTIONS_V2 } from "@/server/sales/questions";

export const PAYMENT_ACTION_INSTRUCTION = "Elige send_payment_instructions únicamente cuando el prospecto confirma explícitamente que quiere pagar por contratar. Preguntar precio, pedir demo de pagos/saldos o mostrar un voucher NO basta. Conserva prioridad de disqualify y de solicitud humana/complejidad; después de las instrucciones un humano confirma pago e implementación.";
export const PAYMENT_ACTION_CRITERION = "El prospecto confirma explícitamente que quiere pagar para contratar el servicio, sin solicitud humana ni complejidad prioritaria. No basta precio, demo de pagos/saldos, voucher ni pagos de alumnos; no confirma dinero recibido ni servicio activado.";
export const PAYMENT_WRITER_INSTRUCTION = "El CRM renderiza los métodos configurados exactos y luego deriva a humano para confirmar pago e implementación. No generar cuentas, teléfonos ni URLs desde el LLM, KB, perfil o conversación; no validar voucher ni confirmar cobro o activación.";

/** Set V3 derivado: no modifica la canónica V2 ni las otras señales. */
export const JEV_SALES_QUESTIONS_V3 = {
  ...JEV_SALES_QUESTIONS_V2,
  next_action: {
    ...JEV_SALES_QUESTIONS_V2.next_action,
    instructions: `${JEV_SALES_QUESTIONS_V2.next_action.instructions} ${PAYMENT_ACTION_INSTRUCTION}`,
    criteria: { ...JEV_SALES_QUESTIONS_V2.next_action.criteria, send_payment_instructions: PAYMENT_ACTION_CRITERION },
  },
};

/** Acción explícita del editor: preserva toda estrategia editada y solo añade pago. */
export function upgradePaymentDraft(config: Config): ConfigV11 {
  if (config.schema_version === "1.1") return config;
  const next = config.jev_questions.next_action;
  if (!next || next.type !== "choice") throw new Error("invalid_next_action");
  return {
    ...config, schema_version: "1.1",
    writer: { ...config.writer, send_payment_instructions: PAYMENT_WRITER_INSTRUCTION },
    jev_questions: {
      ...config.jev_questions,
      next_action: {
        ...next, instructions: `${next.instructions}\n${PAYMENT_ACTION_INSTRUCTION}`,
        criteria: { ...next.criteria, send_payment_instructions: PAYMENT_ACTION_CRITERION },
      },
    },
  };
}
