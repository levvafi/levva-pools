import { runLevvaDeployment } from './deploy-levva-ecosystem';

async function main() {
  await runLevvaDeployment();
}

main().catch((e) => console.error(e));
