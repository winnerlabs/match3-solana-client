import * as anchor from "@coral-xyz/anchor";
import {
    MetadataArgs,
    TokenProgramVersion,
    TokenStandard,
  } from "@metaplex-foundation/mpl-bubblegum";
import { Keypair, Transaction, PublicKey } from "@solana/web3.js";
import idl from "./IDL/idl.json";



export class Match3 {
    public program: anchor.Program;
    constructor(provider: anchor.Provider) {
        const programId = new PublicKey(idl.metadata.address);
        this.program = new anchor.Program(
            idl as anchor.Idl,
            programId,
            provider
        );
    }
    // Only the administrator can call this function.
    async initMatch3Info (admin: Keypair): Promise<[string, PublicKey]> {
        // const adminpk = new PublicKey(process.env.ADMIN_KEY as string);
        // console.log("adminpk:", adminpk.toBase58());
        const connection = this.program.provider.connection;
        const [match3InfoPDA] = await PublicKey.findProgramAddressSync(
            [Buffer.from("match3"), admin.publicKey.toBuffer()],
            this.program.programId
        )
        const [inviterPlaceholderPDA] = PublicKey.findProgramAddressSync(
            [Buffer.from("player_config"), PublicKey.default.toBuffer()],
            this.program.programId
        );
        const tx = await this.program.methods
        .initMatch3()
        .accounts({
            match3Info: match3InfoPDA,
            placeHolder: inviterPlaceholderPDA,
        })
        .signers([admin])
        .rpc();

        return [tx, match3InfoPDA];
    }
}