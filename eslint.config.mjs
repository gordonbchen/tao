import nextVitals from "eslint-config-next/core-web-vitals";
import nextTypescript from "eslint-config-next/typescript";

const config = [
  ...nextVitals,
  ...nextTypescript,
  { ignores: [".next/**", "node_modules/**", "public/mathjax/**", "public/mathjax-font/**", "next-env.d.ts"] },
  { rules: { "react-hooks/set-state-in-effect": "off" } },
];

export default config;
