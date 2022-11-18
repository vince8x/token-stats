import { ChronikClient, Token, Tx } from "chronik-client";
import { parseSLP, ParseResult, SendParseResult, GenesisParseResult, MintParseResult } from "slp-parser";
import yargs from "yargs";
import { hideBin } from 'yargs/helpers';
import * as _ from 'lodash';
import BigNumber from 'bignumber.js';


interface SlpVout {
  outputScript: string;
  txid: string;
  tokenQtyStr: string;
  tokenQty: number;
  isMintBaton?: boolean;
}
interface MapOutputScriptToSlpInfo {
  [outputScript: string]: SlpVout
};

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

// List all valid tokens output
const outputs2Tokens: MapOutputScriptToSlpInfo = {};

// List txs already processed
const processedTxs: { [txid: string]: boolean } = {};

// List all output already spent
const spentOutputs: string[] = [];

let tokensMinted = 0;

const chronik = new ChronikClient('https://chronik.be.cash/xec');
(async () => {
  try {
    if (!tokenId) {
      console.log('Invalid token id');
      return;
    }

    const token = await chronik.token(tokenId);

    console.log('Result from chronik:', token);

    await parseChronikTokenTx(token, tokenId);

    const tokenOutputs = Object.values(outputs2Tokens);

    // Remove the spent output from token outputs
    const unspentTokenOutputs = _.filter(tokenOutputs, item => !spentOutputs.includes(item.outputScript));

    const tokensCirculation = _.sumBy(unspentTokenOutputs, 'tokenQty');
    const tokensBurned = tokensMinted - tokensCirculation;

    console.log(unspentTokenOutputs);
    console.log('minted:', tokensMinted);
    console.log('burned:', tokensBurned);
    console.log('circulation:', tokensCirculation);

  } catch (error) {
    console.error('Unable to process the transactions');
    console.error(JSON.stringify(error));
  }
})();

/**
 * Recursive parse the token transaction data
 * @param tx The transaction result from chronik
 * @returns 
 */
export async function parseChronikTokenTx(token: Token, txid: string) {

  if (processedTxs[txid]) {
    // already processed
    // console.log('already processed: ', txid);
    return;
  }
  const tx = await chronik.tx(txid);

  processedTxs[txid] = true;
  // console.log(txid);

  const { inputs, outputs } = tx;

  const opReturnHex = outputs[0].outputScript;

  // The list of transactions which spend slp output in this transaction
  let spendTxs: string[] = [];

  let parsedTokenResult: ParseResult;
  try {

    parsedTokenResult = parseSLP(Buffer.from(opReturnHex, 'hex'));

    const { tokenType, transactionType, data } = parsedTokenResult;

    // Process TX inputs
    for (let i = 0; i < inputs.length; i++) {
      const input = inputs[i];
      const outScriptOfInput = input.outputScript ?? '';
      spentOutputs.push(outScriptOfInput);
    }

    // Iterate over outputs
    for (let i = 0; i < outputs.length; i += 1) {
      const thisOutput = outputs[i];
      if (tokenType !== 1) {
        continue;
      }

      let thisVout: SlpVout;

      if (transactionType === 'SEND') {
        if (i === 0) {
          // OP_RETURN output, do nothing
          continue;
        }

        // Non SLP outputs - do nothing
        if (i > (data as SendParseResult).amounts.length) {
          continue;
        }

        // SLP output
        const rawQty = (data as SendParseResult).amounts[i - 1];
        // Calculate the real quantity using a BigNumber, then convert it to a
        // floating point number.
        let realQty = new BigNumber(rawQty).dividedBy(
          10 ** token.slpTxData.genesisInfo.decimals
        );
        thisVout = {
          outputScript: thisOutput.outputScript,
          txid: txid,
          tokenQtyStr: realQty.toString(),
          tokenQty: parseFloat(realQty.toString())
        }
        outputs2Tokens[thisOutput.outputScript] = thisVout;
        if (thisOutput.spentBy && thisOutput.spentBy.txid) {
          spendTxs.push(thisOutput.spentBy.txid);
        }
      } else if (
        transactionType === 'GENESIS' ||
        transactionType === 'MINT'
      ) {
        let tokenQty = BigNumber(0); // Default value
        if (i === 0) {
          // OP_RETURN = do nothing
          continue;
        } else if (i === 1) {
          // Only vout[1] of a Genesis or Mint transaction represents the tokens.
          // Any other outputs in that transaction are normal BCH UTXOs.
          tokenQty = (data as (GenesisParseResult | MintParseResult)).qty;

          // Calculate the real quantity using a BigNumber, then convert it to a
          // floating point number.
          let realQty = new BigNumber(tokenQty).dividedBy(
            10 ** token.slpTxData.genesisInfo.decimals
          );
          thisVout = {
            outputScript: thisOutput.outputScript,
            txid: txid,
            tokenQtyStr: realQty.toString(),
            tokenQty: parseFloat(realQty.toString())
          }
          outputs2Tokens[thisOutput.outputScript] = thisVout;
          if (thisOutput.spentBy && thisOutput.spentBy.txid) {
            spendTxs.push(thisOutput.spentBy.txid);
          }
          tokensMinted += realQty.toNumber();
        } else if (i === (data as (GenesisParseResult | MintParseResult)).mintBatonVout) {
          // Optional Mint baton
          thisVout = {
            outputScript: thisOutput.outputScript,
            txid: txid,
            tokenQtyStr: '0',
            tokenQty: 0,
            isMintBaton: true
          }
          outputs2Tokens[thisOutput.outputScript] = thisVout;
          if (thisOutput.spentBy && thisOutput.spentBy.txid) {
            spendTxs.push(thisOutput.spentBy.txid);
          }
        } else {
          // Not slp output
          continue;
        }
      } else {
        throw new Error('Unknown SLP Transaction type');
      }
    }


    //  Deduplicate
    spendTxs = _.uniq(spendTxs)
    // Recursive process the spent transaction list
    for (const tx of spendTxs) {
      await parseChronikTokenTx(token, tx);
    }
  } catch (err) {
    // Error when parse the slp transaction
    // Not a valid slp transaction
    for (let i = 0; i < inputs.length; i++) {
      const input = inputs[i];
      const outScriptOfInput = input.outputScript ?? '';
      spentOutputs.push(outScriptOfInput);
    }
    return;
  }
}