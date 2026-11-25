/**
 * Sistema de Iconografía Clínica — Clínica Salud Integral
 * Paleta: Teal Integral (duotono clínico, grilla 24x24, trazo 1.75px redondeado)
 * Basado en principios de fluidez cognitiva y confianza visual en salud.
 */
(function (global) {
  'use strict';

  function normalizeKey(text) {
    return String(text || '')
      .toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/[^a-z0-9]+/g, ' ')
      .trim();
  }

  const SVGS = {
    anestesiologia: `
      <svg viewBox="0 0 24 24" class="clinical-svg" aria-hidden="true">
        <path class="c-fill" d="M11.5 6.5l6 6-5.2 5.2a2 2 0 01-2.83 0l-3.17-3.17a2 2 0 010-2.83L11.5 6.5z"/>
        <path class="c-stroke" d="M18 2l4 4"/>
        <path class="c-stroke" d="M17 7l3-3"/>
        <path class="c-stroke" d="M19 9L8.7 19.3a1.8 1.8 0 01-2.55 0l-1.45-1.45a1.8 1.8 0 010-2.55L15 5"/>
        <path class="c-stroke" d="M13 3l8 8"/>
        <path class="c-stroke" d="M5 19l-3 3"/>
        <path class="c-thin" d="M10.5 9.5l2 2M8.5 11.5l1.5 1.5"/>
      </svg>`,

    cardiologia: `
      <svg viewBox="0 0 24 24" class="clinical-svg" aria-hidden="true">
        <path class="c-fill" d="M12 20.5s-7.5-4.7-9-9.2C1.9 7.8 4.2 4.5 7.7 4.5c2 0 3.5 1.1 4.3 2.5.8-1.4 2.3-2.5 4.3-2.5 3.5 0 5.8 3.3 4.7 6.8-1.5 4.5-9 9.2-9 9.2z"/>
        <path class="c-stroke" d="M12 20.5s-7.5-4.7-9-9.2C1.9 7.8 4.2 4.5 7.7 4.5c2 0 3.5 1.1 4.3 2.5.8-1.4 2.3-2.5 4.3-2.5 3.5 0 5.8 3.3 4.7 6.8-1.5 4.5-9 9.2-9 9.2z"/>
        <path class="c-stroke" d="M5.5 12h3l1.5-2.8 2.2 5.3 1.6-2.5h4.7"/>
      </svg>`,

    cirugia_general: `
      <svg viewBox="0 0 24 24" class="clinical-svg" aria-hidden="true">
        <path class="c-fill" d="M13.5 5.5l5 5-6.5 6.5H7v-5l6.5-6.5z"/>
        <path class="c-stroke" d="M19.5 4.5a2.1 2.1 0 00-3 0L9 12l3 3 7.5-7.5a2.1 2.1 0 000-3z"/>
        <path class="c-stroke" d="M9 12l-4.5 4.5c-.8.8-.5 2.2.6 2.5l3.9-1 3-3"/>
        <path class="c-thin" d="M14 19h7M15.5 17.5v3M18.5 17.5v3"/>
      </svg>`,

    cirugia_plastica: `
      <svg viewBox="0 0 24 24" class="clinical-svg" aria-hidden="true">
        <path class="c-fill" d="M12 4a6.5 6.5 0 016.5 6.5c0 4.2-2.9 7.8-6.5 9-3.6-1.2-6.5-4.8-6.5-9A6.5 6.5 0 0112 4z"/>
        <path class="c-stroke" d="M12 3.5c3.8 0 6.5 2.8 6.5 6.8 0 4.3-2.9 8-6.5 9.2-3.6-1.2-6.5-4.9-6.5-9.2 0-4 2.7-6.8 6.5-6.8z"/>
        <path class="c-thin" d="M12 3.5v16" stroke-dasharray="2 2.5"/>
        <path class="c-stroke" d="M8.8 10.8c.7-.5 1.5-.5 2.1 0M13.1 10.8c.7-.5 1.5-.5 2.1 0"/>
        <path class="c-stroke" d="M10.2 14.8c1 .7 2.6.7 3.6 0"/>
      </svg>`,

    clinica_medica: `
      <svg viewBox="0 0 24 24" class="clinical-svg" aria-hidden="true">
        <circle class="c-fill" cx="18.5" cy="12" r="2.5"/>
        <path class="c-stroke" d="M5 3v5.5a5 5 0 0010 0V3"/>
        <path class="c-stroke" d="M3.5 3h3M13.5 3h3"/>
        <path class="c-stroke" d="M10 13.5V16a4.25 4.25 0 008.5 0v-1.5"/>
        <circle class="c-stroke" cx="18.5" cy="12" r="2.2"/>
      </svg>`,

    dermatologia: `
      <svg viewBox="0 0 24 24" class="clinical-svg" aria-hidden="true">
        <circle class="c-fill" cx="14.5" cy="9.5" r="4.5"/>
        <circle class="c-stroke" cx="14.5" cy="9.5" r="4.5"/>
        <path class="c-stroke" d="M17.8 12.8L21 16"/>
        <path class="c-stroke" d="M3 16c2.5-1.2 5-1.2 7.5 0s5 1.2 7.5 0"/>
        <path class="c-thin" d="M3 19.5c2.5-1.2 5-1.2 7.5 0s5 1.2 7.5 0"/>
        <path class="c-thin" d="M3 12.5c1.6-.7 3.2-.9 4.8-.6"/>
      </svg>`,

    endocrinologia: `
      <svg viewBox="0 0 24 24" class="clinical-svg" aria-hidden="true">
        <path class="c-fill" d="M12 10.5c-1-3-4.2-4.5-6-3-2 1.7-1.8 6.5.5 8.5 1.8 1.5 4.2.5 5.5-1.5 1.3 2 3.7 3 5.5 1.5 2.3-2 2.5-6.8.5-8.5-1.8-1.5-5 0-6 3z"/>
        <path class="c-stroke" d="M12 10.5c-1-3-4.2-4.5-6-3-2 1.7-1.8 6.5.5 8.5 1.8 1.5 4.2.5 5.5-1.5 1.3 2 3.7 3 5.5 1.5 2.3-2 2.5-6.8.5-8.5-1.8-1.5-5 0-6 3z"/>
        <path class="c-thin" d="M12 3.5v4.5M12 16v4.5"/>
      </svg>`,

    fonoaudiologia: `
      <svg viewBox="0 0 24 24" class="clinical-svg" aria-hidden="true">
        <path class="c-fill" d="M4.5 16.5a5.5 5.5 0 010-9h2.2l3.8-3v15l-3.8-3H4.5z"/>
        <path class="c-stroke" d="M4.5 9.5h2.3l3.7-3.2v11.4l-3.7-3.2H4.5a1.5 1.5 0 01-1.5-1.5v-2a1.5 1.5 0 011.5-1.5z"/>
        <path class="c-stroke" d="M14.2 9.2a4 4 0 010 5.6"/>
        <path class="c-stroke" d="M17.2 6.8a7.5 7.5 0 010 10.4"/>
        <path class="c-thin" d="M20.2 5a10 10 0 010 14"/>
      </svg>`,

    gastroenterologia: `
      <svg viewBox="0 0 24 24" class="clinical-svg" aria-hidden="true">
        <path class="c-fill" d="M11 4v3.2c0 1.4-1.5 2-2.6 2.8-2.2 1.6-2.9 4.8-1.4 7.1 1.5 2.3 4.8 3 7.5 2 3-1.1 5-4 4.8-7.4-.2-3.4-2.7-5.7-5.8-5.7H11V4z"/>
        <path class="c-stroke" d="M10.5 3.5V7c0 1.3-.9 2.2-2.1 3-2.1 1.4-2.9 4.2-1.7 6.5 1.2 2.4 4.3 3.4 7.1 2.5 3.3-1 5.4-4 5.2-7.5-.2-3.4-2.7-5.8-6-5.8"/>
        <path class="c-stroke" d="M6.2 17.2c-.8.7-1.4 1.8-1.5 3.3"/>
      </svg>`,

    gerontologia: `
      <svg viewBox="0 0 24 24" class="clinical-svg" aria-hidden="true">
        <path class="c-fill" d="M12 12.2s-3.6-2.2-4.2-4.3c-.4-1.6.7-3.1 2.2-3.1.9 0 1.6.5 2 1.2.4-.7 1.1-1.2 2-1.2 1.5 0 2.6 1.5 2.2 3.1-.6 2.1-4.2 4.3-4.2 4.3z"/>
        <path class="c-stroke" d="M12 12.2s-3.6-2.2-4.2-4.3c-.4-1.6.7-3.1 2.2-3.1.9 0 1.6.5 2 1.2.4-.7 1.1-1.2 2-1.2 1.5 0 2.6 1.5 2.2 3.1-.6 2.1-4.2 4.3-4.2 4.3z"/>
        <path class="c-stroke" d="M3.5 14.5l3.2 2.8c1 .9 2.3 1.4 3.6 1.4H14a1.7 1.7 0 000-3.4h-3.5"/>
        <path class="c-stroke" d="M20.5 14.5l-3.2 2.8c-.7.6-1.5 1.1-2.3 1.3"/>
      </svg>`,

    ginecologia: `
      <svg viewBox="0 0 24 24" class="clinical-svg" aria-hidden="true">
        <circle class="c-fill" cx="12" cy="9" r="5"/>
        <circle class="c-stroke" cx="12" cy="9" r="5"/>
        <path class="c-stroke" d="M12 14v6.5M9 17.5h6"/>
        <circle class="c-thin" cx="12" cy="9" r="2.1"/>
      </svg>`,

    tocoginecologia: `
      <svg viewBox="0 0 24 24" class="clinical-svg" aria-hidden="true">
        <path class="c-fill" d="M12 3.5l6.5 2.5v5.5c0 4.3-2.8 7.5-6.5 9-3.7-1.5-6.5-4.7-6.5-9V6L12 3.5z"/>
        <path class="c-stroke" d="M12 3.5l6.5 2.5v5.5c0 4.3-2.8 7.5-6.5 9-3.7-1.5-6.5-4.7-6.5-9V6L12 3.5z"/>
        <circle class="c-stroke" cx="12" cy="10" r="2.7"/>
        <path class="c-stroke" d="M12 12.7v3.8M10.2 14.8h3.6"/>
      </svg>`,

    infectologia: `
      <svg viewBox="0 0 24 24" class="clinical-svg" aria-hidden="true">
        <path class="c-fill" d="M12 3l7 3v5.5c0 4.6-3 8.1-7 9.5-4-1.4-7-4.9-7-9.5V6l7-3z"/>
        <path class="c-stroke" d="M12 3l7 3v5.5c0 4.6-3 8.1-7 9.5-4-1.4-7-4.9-7-9.5V6l7-3z"/>
        <circle class="c-stroke" cx="12" cy="11.5" r="2.4"/>
        <path class="c-thin" d="M12 7.5v1.5M12 14v1.5M8 11.5h1.5M14.5 11.5H16M9.2 8.7l1 1M13.8 13.3l1 1M14.8 8.7l-1 1M10.2 13.3l-1 1"/>
      </svg>`,

    kinesiologia: `
      <svg viewBox="0 0 24 24" class="clinical-svg" aria-hidden="true">
        <circle class="c-fill" cx="12" cy="5.5" r="2.2"/>
        <circle class="c-stroke" cx="12" cy="5.5" r="2"/>
        <path class="c-stroke" d="M6.5 9.8c2.2 1.2 4 1.6 5.5 1.6s3.3-.4 5.5-1.6"/>
        <path class="c-stroke" d="M12 11.4v4.4"/>
        <path class="c-stroke" d="M12 15.8l-3.5 4.7M12 15.8l3.5 4.7"/>
        <path class="c-thin" d="M4.5 14.5a8.5 8.5 0 0115 0" stroke-dasharray="2 2.5"/>
      </svg>`,

    nefrologia: `
      <svg viewBox="0 0 24 24" class="clinical-svg" aria-hidden="true">
        <path class="c-fill" d="M8.5 5.5c-2.6 0-4.5 2.4-4.5 5.5s1.9 5.5 4.5 5.5c1.4 0 2.3-.9 2.3-2.2 0-1-.7-1.6-.7-3.3s.7-2.3.7-3.3c0-1.3-.9-2.2-2.3-2.2zM15.5 5.5c2.6 0 4.5 2.4 4.5 5.5s-1.9 5.5-4.5 5.5c-1.4 0-2.3-.9-2.3-2.2 0-1 .7-1.6.7-3.3s-.7-2.3-.7-3.3c0-1.3.9-2.2 2.3-2.2z"/>
        <path class="c-stroke" d="M8.5 5.5c-2.6 0-4.5 2.4-4.5 5.5s1.9 5.5 4.5 5.5c1.4 0 2.3-.9 2.3-2.2 0-1-.7-1.6-.7-3.3s.7-2.3.7-3.3c0-1.3-.9-2.2-2.3-2.2z"/>
        <path class="c-stroke" d="M15.5 5.5c2.6 0 4.5 2.4 4.5 5.5s-1.9 5.5-4.5 5.5c-1.4 0-2.3-.9-2.3-2.2 0-1 .7-1.6.7-3.3s-.7-2.3-.7-3.3c0-1.3.9-2.2 2.3-2.2z"/>
        <path class="c-thin" d="M10.2 12.2v6.8M13.8 12.2v6.8"/>
      </svg>`,

    neumonologia: `
      <svg viewBox="0 0 24 24" class="clinical-svg" aria-hidden="true">
        <path class="c-fill" d="M9.5 8.5c-2.7 0-5.5 2.5-5.5 7 0 2.2 1.3 3.5 3.3 3.5 1.8 0 2.7-1.2 2.7-3V8.5h-.5zM14.5 8.5c2.7 0 5.5 2.5 5.5 7 0 2.2-1.3 3.5-3.3 3.5-1.8 0-2.7-1.2-2.7-3V8.5h.5z"/>
        <path class="c-stroke" d="M12 4v6.5M12 10.5L9.5 13M12 10.5l2.5 2.5"/>
        <path class="c-stroke" d="M9.5 8.5c-2.7 0-5.5 2.5-5.5 7 0 2.2 1.3 3.5 3.3 3.5 1.8 0 2.7-1.2 2.7-3V9.5"/>
        <path class="c-stroke" d="M14.5 8.5c2.7 0 5.5 2.5 5.5 7 0 2.2-1.3 3.5-3.3 3.5-1.8 0-2.7-1.2-2.7-3V9.5"/>
      </svg>`,

    neurologia: `
      <svg viewBox="0 0 24 24" class="clinical-svg" aria-hidden="true">
        <path class="c-fill" d="M12 5a4.5 4.5 0 00-4.3 3.2A3.8 3.8 0 004.5 12c0 1.7 1.1 3.2 2.7 3.7A3.8 3.8 0 0012 18.8a3.8 3.8 0 004.8-3.1c1.6-.5 2.7-2 2.7-3.7a3.8 3.8 0 00-3.2-3.8A4.5 4.5 0 0012 5z"/>
        <path class="c-stroke" d="M12 5v14"/>
        <path class="c-stroke" d="M12 5.2A4 4 0 007.8 8a3.6 3.6 0 00-3.3 3.7c0 1.6 1 3 2.5 3.5a3.4 3.4 0 005 3.4"/>
        <path class="c-stroke" d="M12 5.2A4 4 0 0116.2 8a3.6 3.6 0 013.3 3.7c0 1.6-1 3-2.5 3.5a3.4 3.4 0 01-5 3.4"/>
        <circle class="c-dot" cx="8.5" cy="11" r="1"/>
        <circle class="c-dot" cx="15.5" cy="11" r="1"/>
        <path class="c-thin" d="M8.5 11l3.5-1.5 3.5 1.5M9.5 14.5L12 13l2.5 1.5"/>
      </svg>`,

    obstetricia: `
      <svg viewBox="0 0 24 24" class="clinical-svg" aria-hidden="true">
        <circle class="c-fill" cx="12" cy="13.5" r="5"/>
        <circle class="c-stroke" cx="12" cy="5.8" r="2"/>
        <path class="c-stroke" d="M7.2 10.8a6.2 6.2 0 109.6 0"/>
        <path class="c-stroke" d="M12 16s-2.4-1.5-2.8-2.9c-.3-1 .5-2 1.5-2 .6 0 1.1.3 1.3.8.2-.5.7-.8 1.3-.8 1 0 1.8 1 1.5 2-.4 1.4-2.8 2.9-2.8 2.9z"/>
      </svg>`,

    odontologia: `
      <svg viewBox="0 0 24 24" class="clinical-svg" aria-hidden="true">
        <path class="c-fill" d="M7.8 4.5c-2.2 0-3.8 1.8-3.8 4.3 0 2.7 1.1 5.3 1.8 8 .5 1.9 1.6 2.7 2.5 2.7.9 0 1.4-1 1.8-2.6.4-1.4 1.1-2.1 1.9-2.1s1.5.7 1.9 2.1c.4 1.6.9 2.6 1.8 2.6.9 0 2-.8 2.5-2.7.7-2.7 1.8-5.3 1.8-8 0-2.5-1.6-4.3-3.8-4.3-1.4 0-2.7.8-4.2.8s-2.8-.8-4.2-.8z"/>
        <path class="c-stroke" d="M7.8 4.5c-2.2 0-3.8 1.8-3.8 4.3 0 2.7 1.1 5.3 1.8 8 .5 1.9 1.6 2.7 2.5 2.7.9 0 1.4-1 1.8-2.6.4-1.4 1.1-2.1 1.9-2.1s1.5.7 1.9 2.1c.4 1.6.9 2.6 1.8 2.6.9 0 2-.8 2.5-2.7.7-2.7 1.8-5.3 1.8-8 0-2.5-1.6-4.3-3.8-4.3-1.4 0-2.7.8-4.2.8s-2.8-.8-4.2-.8z"/>
        <path class="c-thin" d="M7.5 8.5c0-1 .7-1.6 1.6-1.6"/>
      </svg>`,

    oncologia: `
      <svg viewBox="0 0 24 24" class="clinical-svg" aria-hidden="true">
        <circle class="c-fill" cx="12" cy="12" r="9"/>
        <circle class="c-thin" cx="12" cy="12" r="9"/>
        <path class="c-stroke" d="M9.2 16.8l4.5-6.6a2.3 2.3 0 00-1.7-3.8 2.3 2.3 0 00-1.7 3.8l4.5 6.6"/>
      </svg>`,

    pediatria: `
      <svg viewBox="0 0 24 24" class="clinical-svg" aria-hidden="true">
        <circle class="c-fill" cx="9" cy="7.5" r="2.6"/>
        <circle class="c-fill" cx="16.2" cy="10.2" r="2"/>
        <circle class="c-stroke" cx="9" cy="7.5" r="2.5"/>
        <path class="c-stroke" d="M4.2 19.5v-2.2a4.8 4.8 0 019.6 0v2.2"/>
        <circle class="c-stroke" cx="16.3" cy="10.3" r="1.9"/>
        <path class="c-stroke" d="M13.8 19.5v-1.7a3.3 3.3 0 016.2-1.2v2.9"/>
      </svg>`,

    psicologia: `
      <svg viewBox="0 0 24 24" class="clinical-svg" aria-hidden="true">
        <path class="c-fill" d="M12 4a6.5 6.5 0 00-6.5 6.5c0 2.4 1.3 4.5 3.2 5.6V19a1.5 1.5 0 001.5 1.5h3.6A1.5 1.5 0 0015.3 19v-2.2l1.8-.4a1.2 1.2 0 00.9-1.4l-.4-2.1a6.5 6.5 0 00-5.6-8.9z"/>
        <path class="c-stroke" d="M8.8 19.5v-3A6.5 6.5 0 1117.7 12l1 2.2a1 1 0 01-.9 1.4h-1.3v1.9a2 2 0 01-2 2H8.8z"/>
        <path class="c-thin" d="M9.8 10.5c.8-.9 2.2-.9 3 0 .8.9 2.2.9 3 0"/>
        <path class="c-thin" d="M10.5 13.2c1 .6 2.2.6 3.2 0"/>
      </svg>`,

    psiquiatria: `
      <svg viewBox="0 0 24 24" class="clinical-svg" aria-hidden="true">
        <path class="c-fill" d="M8.8 19.5v-3A6.5 6.5 0 1117.7 12l1 2.2a1 1 0 01-.9 1.4h-1.3v1.9a2 2 0 01-2 2H8.8z"/>
        <path class="c-stroke" d="M8.8 19.5v-3A6.5 6.5 0 1117.7 12l1 2.2a1 1 0 01-.9 1.4h-1.3v1.9a2 2 0 01-2 2H8.8z"/>
        <path class="c-stroke" d="M12 8.2v4.6M9.7 10.5h4.6"/>
      </svg>`,

    reumatologia: `
      <svg viewBox="0 0 24 24" class="clinical-svg" aria-hidden="true">
        <circle class="c-fill" cx="12" cy="12" r="4.2"/>
        <path class="c-stroke" d="M9.5 3.5v4.3c0 1.2 1.1 2 2.5 2s2.5-.8 2.5-2V3.5"/>
        <path class="c-stroke" d="M9.5 20.5v-4.3c0-1.2 1.1-2 2.5-2s2.5.8 2.5 2v4.3"/>
        <circle class="c-thin" cx="12" cy="12" r="2.2"/>
        <path class="c-thin" d="M6.2 9.5a6.5 6.5 0 000 5M17.8 9.5a6.5 6.5 0 010 5"/>
      </svg>`,

    traumatologia: `
      <svg viewBox="0 0 24 24" class="clinical-svg" aria-hidden="true">
        <path class="c-fill" d="M16.5 4.2a2.2 2.2 0 00-1.7 3.5l-7.1 7.1a2.2 2.2 0 10-1.4 3.9 2.2 2.2 0 003.9-1.4l7.1-7.1a2.2 2.2 0 10-.8-6z"/>
        <path class="c-stroke" d="M17 5a2 2 0 10-2.8 2.8l-6.4 6.4A2 2 0 105 17a2 2 0 102.8 2.8 2 2 0 001.4-2.8l6.4-6.4A2 2 0 1019 7a2 2 0 00-2-2z"/>
        <path class="c-thin" d="M11 11l2 2"/>
      </svg>`,

    urologia: `
      <svg viewBox="0 0 24 24" class="clinical-svg" aria-hidden="true">
        <path class="c-fill" d="M7.5 11.5h9c0 3.2-2 5.5-4.5 5.5s-4.5-2.3-4.5-5.5z"/>
        <path class="c-stroke" d="M7 4.5c0 2.5 1.3 4.2 3 5.5M17 4.5c0 2.5-1.3 4.2-3 5.5"/>
        <path class="c-stroke" d="M7.2 11.2c0 3.4 2.1 5.8 4.8 5.8s4.8-2.4 4.8-5.8c0-.8-.7-1.4-1.5-1.4H8.7c-.8 0-1.5.6-1.5 1.4z"/>
        <path class="c-stroke" d="M12 17v3.5"/>
        <circle class="c-thin" cx="7" cy="4.5" r="1.2"/>
        <circle class="c-thin" cx="17" cy="4.5" r="1.2"/>
      </svg>`,

    fast_slot: `
      <svg viewBox="0 0 24 24" class="clinical-svg" aria-hidden="true">
        <circle class="c-fill" cx="12" cy="12" r="8.5"/>
        <circle class="c-stroke" cx="12" cy="12" r="8.5"/>
        <path class="c-stroke" d="M12 7.5v4.5l3 2"/>
        <path class="c-thin" d="M18.5 4.5l2 2"/>
      </svg>`,

    calendar_mini: `
      <svg viewBox="0 0 24 24" class="clinical-svg" aria-hidden="true">
        <rect class="c-stroke" x="3.5" y="5" width="17" height="15.5" rx="2.5"/>
        <path class="c-stroke" d="M8 3.2v3.3M16 3.2v3.3M3.5 9.8h17"/>
      </svg>`,

    clock_mini: `
      <svg viewBox="0 0 24 24" class="clinical-svg" aria-hidden="true">
        <circle class="c-stroke" cx="12" cy="12" r="8.5"/>
        <path class="c-stroke" d="M12 7.5v4.8l3.2 1.8"/>
      </svg>`,

    default_medical: `
      <svg viewBox="0 0 24 24" class="clinical-svg" aria-hidden="true">
        <rect class="c-fill" x="4" y="4" width="16" height="16" rx="4"/>
        <rect class="c-stroke" x="4" y="4" width="16" height="16" rx="4"/>
        <path class="c-stroke" d="M12 8v8M8 12h8"/>
      </svg>`,
  };

  function resolveKey(specialtyName) {
    const n = normalizeKey(specialtyName);
    if (!n) return 'default_medical';
    if (n === 'fast slot' || n === 'fast-slot') return 'fast_slot';
    if (n === 'calendar mini' || n === 'calendar-mini') return 'calendar_mini';
    if (n === 'clock mini' || n === 'clock-mini') return 'clock_mini';

    if (n.includes('anestesi')) return 'anestesiologia';
    if (n.includes('cardio')) return 'cardiologia';
    if (n.includes('plastica') || n.includes('estetica')) return 'cirugia_plastica';
    if (n.includes('cirugia')) return 'cirugia_general';
    if (n.includes('clinica medica') || n.includes('medicina general') || n.includes('medicina familiar')) return 'clinica_medica';
    if (n.includes('dermato')) return 'dermatologia';
    if (n.includes('endocrino') || n.includes('diabeto')) return 'endocrinologia';
    if (n.includes('fonoaudio')) return 'fonoaudiologia';
    if (n.includes('gastro')) return 'gastroenterologia';
    if (n.includes('geronto') || n.includes('geriatr')) return 'gerontologia';
    if (n.includes('tocogineco')) return 'tocoginecologia';
    if (n.includes('gineco')) return 'ginecologia';
    if (n.includes('obstetr')) return 'obstetricia';
    if (n.includes('infecto')) return 'infectologia';
    if (n.includes('kinesio') || n.includes('fisiatr') || n.includes('fisioterap')) return 'kinesiologia';
    if (n.includes('nefro')) return 'nefrologia';
    if (n.includes('neumono') || n.includes('neumo')) return 'neumonologia';
    if (n.includes('neuro')) return 'neurologia';
    if (n.includes('odonto')) return 'odontologia';
    if (n.includes('onco')) return 'oncologia';
    if (n.includes('pediatr')) return 'pediatria';
    if (n.includes('psiquiatr')) return 'psiquiatria';
    if (n.includes('psicolo')) return 'psicologia';
    if (n.includes('reumato')) return 'reumatologia';
    if (n.includes('traumato') || n.includes('ortoped')) return 'traumatologia';
    if (n.includes('urolo')) return 'urologia';

    return 'default_medical';
  }

  function render(specialtyName, variant) {
    const mode = variant || 'card';
    const key = resolveKey(specialtyName);
    const svg = SVGS[key] || SVGS.default_medical;

    if (mode === 'inline') {
      return `<span class="clinical-icon-inline">${svg}</span>`;
    }
    if (mode === 'meta') {
      return `<span class="clinical-icon-meta">${svg}</span>`;
    }
    return `<span class="clinical-icon-badge">${svg}</span>`;
  }

  global.ClinicalIcons = {
    render,
    resolveKey,
  };
})(window);
