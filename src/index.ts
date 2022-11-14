import { ChronikClient, Tx } from "chronik-client";
import yargs from "yargs";
import { hideBin } from 'yargs/helpers'

const args = yargs(hideBin(process.argv))
  .alias('v', 'version')
  .alias('h', 'help')
  .usage('Usage: Get the stats of an ecash token')
  .showHelpOnFail(false, 'Specify --help for avalable options')
  .options({
    'help': { alias: 'h', describe: 'Show help' },
    'token': { type: 'string', demandOption: false, alias: 't', desc: 'Specify the token' },
  })
  .check((argv) => {
    if (argv.token) {
      return true;
    }
    throw new Error(`
      You must specify the token id
    `);
  }).parse();

const tokenId = (args as any)['token'];

const chronik = new ChronikClient('https://chronik.be.cash/xec');
(async () => {
  try {
    if (!tokenId) {
      console.log('Invalid token id');
      return;
    }
    const tokenInfo = await chronik.token(tokenId);
    const tx = await chronik.tx(tokenId);
    if (!tx.slpTxData || !tx.slpTxData.genesisInfo) {
      console.log('Invalid token. The token id is not equal to genesis transaction id');
      return;
    }
    console.log(JSON.stringify(tx));


  } catch (error) {
    console.error('Unable to process the transactions');
    console.error(JSON.stringify(error));
  }
})();

export async function parseChronikTx(tx: Tx) {

  const { inputs, outputs } = tx;

  // Iterate over inputs to see if this is an incoming tx (incoming === true)
  for (let i = 0; i < inputs.length; i += 1) {
    
  }
}