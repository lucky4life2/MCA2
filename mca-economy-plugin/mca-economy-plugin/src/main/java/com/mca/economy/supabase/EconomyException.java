package com.mca.economy.supabase;

/** Thrown when a Supabase RPC call fails — either a network problem or a
 *  RAISE EXCEPTION from one of the Postgres economy functions. The message
 *  is safe to show directly to a player (it's the same text a website error
 *  toast would show). */
public class EconomyException extends Exception {
    public EconomyException(String message) {
        super(message);
    }

    public EconomyException(String message, Throwable cause) {
        super(message, cause);
    }
}
