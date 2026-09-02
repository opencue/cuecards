import type { ProfileSuggestionLabel } from "../../src/lib/profile-suggestion-eval";

export interface ProfileSuggestionFixture extends ProfileSuggestionLabel {
  files: Record<string, string>;
}

const pkg = (dependencies: Record<string, string>, devDependencies?: Record<string, string>) =>
  JSON.stringify({ dependencies, ...(devDependencies ? { devDependencies } : {}) });

/**
 * Small, source-controlled repository shapes. Labels describe the primary Cue
 * profile, not every integration a real project might combine with it.
 */
export const PROFILE_SUGGESTION_FIXTURES: ProfileSuggestionFixture[] = [
  {
    id: "nextjs-app-router",
    expected: ["nextjs"],
    expectAutoSelect: true,
    forbiddenTop: ["medusa-next", "medusa-vite"],
    files: { "package.json": pkg({ next: "15", react: "19" }), "next.config.ts": "export default {}" },
  },
  {
    id: "vite-react-app",
    expected: ["vite"],
    forbiddenTop: ["nextjs"],
    files: { "package.json": pkg({ react: "19" }, { vite: "7" }), "vite.config.ts": "export default {}" },
  },
  {
    id: "medusa-next-storefront",
    expected: ["medusa-next"],
    forbiddenTop: ["medusa-vite"],
    files: { "package.json": pkg({ next: "15", "@medusajs/js-sdk": "2" }), "next.config.ts": "export default {}" },
  },
  {
    id: "medusa-vite-storefront",
    expected: ["medusa-vite"],
    forbiddenTop: ["medusa-next"],
    files: { "package.json": pkg({ react: "19", "@medusajs/js-sdk": "2" }, { vite: "7" }), "vite.config.ts": "export default {}" },
  },
  {
    id: "rust-service",
    expected: ["rust"],
    files: { "Cargo.toml": "[package]\nname='svc'\n[dependencies]\ntokio='1'\n", "src/main.rs": "fn main() {}" },
  },
  {
    id: "go-api",
    expected: ["go-api"],
    files: { "go.mod": "module example.com/api\n", "main.go": "package main" },
  },
  {
    id: "python-fastapi",
    expected: ["python"],
    files: { "pyproject.toml": "[project]\ndependencies=['fastapi', 'uvicorn']\n", "app/main.py": "from fastapi import FastAPI" },
  },
  {
    id: "python-scripts-no-manifest",
    expected: ["python"],
    forbiddenTop: ["vite", "stripe", "coolify"],
    files: {
      "main.py": "print('hello')",
      "worker.py": "def run(): pass",
    },
  },
  {
    id: "env-stripe-integration",
    expected: ["stripe"],
    forbiddenTop: ["coolify"],
    files: {
      ".env.example": "STRIPE_SECRET_KEY=replace-me\n",
      "server.ts": "export const app = true",
    },
  },
  {
    id: "ros2-robot",
    expected: ["ros2"],
    files: { "package.xml": "<package format='3'></package>", "CMakeLists.txt": "find_package(ament_cmake REQUIRED)", "robot.urdf": "<robot/>" },
  },
  {
    id: "stripe-integration",
    expected: ["stripe"],
    expectAutoSelect: false,
    files: { "package.json": pkg({ stripe: "18" }), "payments.ts": "export const payments = true" },
  },
  {
    id: "aws-infrastructure-sdk",
    expected: ["aws"],
    files: { "package.json": pkg({ "@aws-sdk/client-s3": "3" }), "deploy.ts": "export const bucket = true" },
  },
  {
    id: "supabase-app",
    expected: ["supabase"],
    files: { "package.json": pkg({ "@supabase/supabase-js": "2" }), "supabase/config.toml": "project_id='app'" },
  },
  {
    id: "threejs-scene",
    expected: ["threejs"],
    files: { "package.json": pkg({ three: "0.180" }), "scene.ts": "import * as THREE from 'three'" },
  },
  {
    id: "react-native-expo",
    expected: ["react-native"],
    forbiddenTop: ["frontend"],
    files: { "package.json": pkg({ expo: "54", react: "19", "react-native": "0.81" }), "app.json": "{}" },
  },
  {
    id: "docusaurus-docs",
    expected: ["docs-writer"],
    files: { "package.json": pkg({ "@docusaurus/core": "3" }), "docusaurus.config.js": "export default {}" },
  },
  {
    id: "google-ads-campaigns",
    expected: ["google-ads"],
    forbiddenTop: ["coolify"],
    files: { "package.json": pkg({ "google-ads-api": "21" }), "gaql-query.ts": "export const query = 'SELECT campaign.id'" },
  },
  {
    id: "browser-playwright",
    expected: ["browser"],
    files: { "package.json": pkg({}, { "@playwright/test": "1" }), "playwright.config.ts": "export default {}" },
  },
  {
    id: "coolify-deployment",
    expected: ["coolify"],
    files: { ".coolify/config.json": "{}", "docker-compose.yml": "services:\n  app:\n    image: example/app" },
  },
  {
    id: "marketing-campaign",
    expected: ["marketing"],
    forbiddenTop: ["backend", "google-ads"],
    files: { "package.json": pkg({ "marketing-api": "1" }), "campaign-plan.md": "Audience, campaign, conversion, and content calendar", "docker-compose.yml": "services: {}" },
  },
  {
    id: "nextjs-with-stripe",
    expected: ["nextjs"],
    expectedStack: ["nextjs", "stripe"],
    expectAutoSelect: true,
    files: { "package.json": pkg({ next: "15", react: "19", stripe: "18" }), "next.config.ts": "export default {}" },
  },
  {
    id: "vite-with-supabase",
    expected: ["vite"],
    expectedStack: ["vite", "supabase"],
    files: { "package.json": pkg({ react: "19", "@supabase/supabase-js": "2" }, { vite: "7" }), "vite.config.ts": "export default {}" },
  },
  {
    id: "python-with-aws",
    expected: ["python"],
    expectedStack: ["python", "aws"],
    files: { "requirements.txt": "fastapi==0.116\nboto3==1.40\n", "app/main.py": "from fastapi import FastAPI" },
  },
  {
    id: "docker-node-api",
    expected: ["backend"],
    expectAutoSelect: false,
    forbiddenTop: ["coolify"],
    files: { "package.json": pkg({ express: "5" }), "Dockerfile": "FROM node:22" },
  },
  {
    id: "ads-automation",
    expected: ["ads-manager"],
    expectAutoSelect: false,
    forbiddenTop: ["backend"],
    files: {
      "README.md": "Automation utilities for advertising campaigns",
    },
  },
  {
    id: "medusa-backend",
    expected: ["medusa-dev"],
    forbiddenTop: ["medusa-next", "medusa-vite"],
    files: { "package.json": pkg({ "@medusajs/medusa": "2" }), "medusa-config.ts": "export default {}" },
  },
  {
    id: "workspace-next-monorepo",
    expected: ["nextjs"],
    files: {
      "package.json": JSON.stringify({ private: true, dependencies: { turbo: "2" }, workspaces: ["apps/*"] }),
      "apps/web/package.json": pkg({ next: "15", react: "19" }),
      "apps/web/next.config.ts": "export default {}",
    },
  },
  {
    id: "nvidia-jetson-device",
    expected: ["jetson"],
    expectedStack: ["jetson", "python"],
    expectAutoSelect: true,
    files: {
      "requirements.txt": "jetson-stats==4.3.2\njetson-containers==0.4.2\n",
      "src/device_probe.py": "from jtop import jtop\n",
    },
  },
];
