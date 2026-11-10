import type { Env } from './core';

type Lang = 'en' | 'pt' | 'es';
const T = {
  verify: {
    en: { s: 'Confirm your Helper Connect email', b: (u: string) => `Welcome to Helper Connect.\n\nConfirm your email to activate your account:\n${u}\n\nThis link expires in 24 hours. If you did not create this account, ignore this message.` },
    pt: { s: 'Confirme seu e-mail do Helper Connect', b: (u: string) => `Bem-vindo ao Helper Connect.\n\nConfirme seu e-mail para ativar sua conta:\n${u}\n\nEste link expira em 24 horas. Se você não criou esta conta, ignore esta mensagem.` },
    es: { s: 'Confirma tu correo de Helper Connect', b: (u: string) => `Bienvenido a Helper Connect.\n\nConfirma tu correo para activar tu cuenta:\n${u}\n\nEste enlace vence en 24 horas. Si no creaste esta cuenta, ignora este mensaje.` },
  },
  reset: {
    en: { s: 'Reset your Helper Connect password', b: (u: string) => `Use this link to choose a new password:\n${u}\n\nIt expires in 1 hour. If you did not request this, ignore this message.` },
    pt: { s: 'Redefina sua senha do Helper Connect', b: (u: string) => `Use este link para escolher uma nova senha:\n${u}\n\nEle expira em 1 hora. Se você não solicitou, ignore esta mensagem.` },
    es: { s: 'Restablece tu contraseña de Helper Connect', b: (u: string) => `Usa este enlace para elegir una nueva contraseña:\n${u}\n\nVence en 1 hora. Si no lo solicitaste, ignora este mensaje.` },
  },
};

/** Sends via Resend (free tier, needs API key). Returns false when no provider is configured. */
export async function sendAuthEmail(env: Env, kind: 'verify' | 'reset', to: string, lang: Lang, token: string, origin: string): Promise<boolean> {
  if (!env.RESEND_API_KEY || !env.EMAIL_FROM) return false;
  const path = kind === 'verify' ? 'verify-email' : 'reset-password';
  const url = `${env.APP_ORIGIN ?? origin}/${path}?token=${encodeURIComponent(token)}`;
  const tpl = T[kind][lang];
  try {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${env.RESEND_API_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ from: env.EMAIL_FROM, to: [to], subject: tpl.s, text: tpl.b(url) }),
    });
    return res.ok;
  } catch {
    return false;
  }
}
