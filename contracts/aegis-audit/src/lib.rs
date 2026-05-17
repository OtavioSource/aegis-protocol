#![no_std]
//! Aegis Audit — Soroban contract that records each governance decision as an on-chain event.
//!
//! Esse é um stub mínimo do scaffolding (iteração 1). A implementação completa,
//! incluindo `record_decision`, `initialize`, `set_admin`, e o struct `DecisionRecord`
//! com topics indexados por `companyId`, será adicionada na iteração 11 do roadmap.
//!
//! Design completo em [docs/08-soroban-audit.md].

use soroban_sdk::{contract, contractimpl, symbol_short, Env, Symbol};

#[contract]
pub struct AegisAudit;

#[contractimpl]
impl AegisAudit {
    /// Stub de saúde — apenas confirma que o contrato compila e pode ser invocado.
    /// Substituído por `initialize` + `record_decision` na iteração 11.
    pub fn ping(_env: Env) -> Symbol {
        symbol_short!("pong")
    }
}

#[cfg(test)]
mod test {
    use super::*;
    use soroban_sdk::Env;

    #[test]
    fn ping_returns_pong() {
        let env = Env::default();
        let contract_id = env.register_contract(None, AegisAudit);
        let client = AegisAuditClient::new(&env, &contract_id);
        let result = client.ping();
        assert_eq!(result, symbol_short!("pong"));
    }
}
