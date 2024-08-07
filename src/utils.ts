import * as anchor from "@coral-xyz/anchor";
import { Context, TransactionSignature } from '@metaplex-foundation/umi';
import { LeafSchema, getLeafSchemaSerializer} from "@metaplex-foundation/mpl-bubblegum";
import { PublicKey, Connection } from '@solana/web3.js';
import { Queue } from "@switchboard-xyz/on-demand";
import * as fs from "fs";

export async function parseLeafFromMintV1Transaction(
    context: Pick<Context, 'programs' | 'eddsa' | 'rpc'>,
    signature: TransactionSignature,
    playerConfigIsExist: boolean,
  ): Promise<LeafSchema> {
    const transaction = await context.rpc.getTransaction(signature);
    if (!transaction) {
        throw new Error('Could not find transaction');
    }
    const innerInstructions = transaction?.meta.innerInstructions;

    if (!innerInstructions) {
        throw new Error('Could not find inner instructions in transaction');
    }
    if (innerInstructions) {
      let leaf: [LeafSchema, number];
      if (playerConfigIsExist) {
          leaf = getLeafSchemaSerializer().deserialize(
            innerInstructions[0].instructions[2].data.slice(8)
          );
      } else {
          leaf = getLeafSchemaSerializer().deserialize(
            innerInstructions[0].instructions[3].data.slice(8)
          );
      }
      console.log("leaf: ", leaf)
      return leaf[0];
    }

    throw new Error('Could not parse leaf from transaction');
}

export async function checkPdaAccountExistence(pda: PublicKey, connection: Connection): Promise<boolean> {
    try {
        const accountInfo = await connection.getAccountInfo(pda);
        console.log("account is exist")
        return accountInfo !== null;
    } catch (error) {
        console.log("account is not exist")
        return false;
    }
}

export function LoadProgramIdl(filepath: string) {
    return JSON.parse(fs.readFileSync(filepath, "utf8"));
  }


  export async function createSbQueue(program: anchor.Program): Promise<PublicKey> {
    const queue = new PublicKey("FfD96yeXs4cxZshoPPSKhSPgVQxLAJUT3gefgh84m1Di");
    //mainet queue = "A43DyUGA7s8eXPxqEjJY6EBu1KKbNgfxF8h17VAHn13w"
    const queueAccount = new Queue(program, queue);
    console.log("Queue account", queue.toString());
    try {
      await queueAccount.loadData();
    } catch (err) {
      console.error("Queue not found, ensure you are using devnet in your env");
      process.exit(1);
    }
    return queue;
  }