import { hasCredits } from "./config.js"
import { configureDeploymentPayer } from "./deployment-payer.js"

/** Workers have their own singleton state; a queued payer context is not boot configuration. */
export async function initializeExternalWallet(initializePayer = false): Promise<void> {
  if (![process.env.DEPLOYMENT_WALLET_URL, process.env.DEPLOYMENT_WALLET_TOKEN, process.env.DEPLOYMENT_WALLET_SSO_PROVIDER].some(Boolean)) return
  if (!hasCredits()) throw new Error("External wallet requires the cloud credit system")
  if (initializePayer) {
    const result = await configureDeploymentPayer()
    if (!result.ok) throw new Error("External wallet payer could not be initialized")
  }
  const wallet = await import("../ee/billing/external-wallet.js")
  wallet.validateExternalWallet()
}
