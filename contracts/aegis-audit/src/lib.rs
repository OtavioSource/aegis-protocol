#![no_std]
use soroban_sdk::{
    contract, contractimpl, contracttype, Address, BytesN, Env, Symbol,
};

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub enum Decision {
    Approved,
    RequiresApproval,
    Rejected,
    ApprovedByHuman,
    RejectedByHuman,
    Expired,
    ExecutionFailed,
    Executed,
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct DecisionRecord {
    pub spend_request_id: BytesN<16>,
    pub agent_id: BytesN<16>,
    pub vendor_id: BytesN<16>,
    pub amount_cents: i128,
    pub asset_code: Symbol,
    pub decision: Decision,
    pub reason_hash: BytesN<32>,
    pub timestamp: u64,
    pub policy_id: BytesN<16>,
    pub policy_version: u32,
}

#[contracttype]
enum DataKey {
    Admin,
}

#[contract]
pub struct AegisAudit;

#[contractimpl]
impl AegisAudit {
    pub fn initialize(env: Env, admin: Address) {
        if env.storage().instance().has(&DataKey::Admin) {
            panic!("already initialized");
        }
        env.storage().instance().set(&DataKey::Admin, &admin);
    }

    pub fn record_decision(env: Env, company_id: BytesN<16>, record: DecisionRecord) {
        let admin: Address = env
            .storage()
            .instance()
            .get(&DataKey::Admin)
            .expect("not initialized");
        admin.require_auth();
        let topics = (
            Symbol::new(&env, "aegis"),
            Symbol::new(&env, "decision"),
            company_id,
        );
        env.events().publish(topics, record);
    }

    pub fn get_admin(env: Env) -> Address {
        env.storage()
            .instance()
            .get(&DataKey::Admin)
            .expect("not initialized")
    }

    pub fn set_admin(env: Env, new_admin: Address) {
        let current: Address = env
            .storage()
            .instance()
            .get(&DataKey::Admin)
            .expect("not initialized");
        current.require_auth();
        env.storage().instance().set(&DataKey::Admin, &new_admin);
    }
}

#[cfg(test)]
mod test {
    use super::*;
    use soroban_sdk::{
        testutils::{Address as _, Events as _},
        Address, BytesN, Env, Symbol,
    };

    fn setup() -> (Env, AegisAuditClient<'static>, Address) {
        let env = Env::default();
        env.mock_all_auths();
        let contract_id = env.register_contract(None, AegisAudit);
        let client = AegisAuditClient::new(&env, &contract_id);
        let admin = Address::generate(&env);
        client.initialize(&admin);
        (env, client, admin)
    }

    #[test]
    fn initialize_sets_admin() {
        let env = Env::default();
        let contract_id = env.register_contract(None, AegisAudit);
        let client = AegisAuditClient::new(&env, &contract_id);
        let admin = Address::generate(&env);
        client.initialize(&admin);
        assert_eq!(client.get_admin(), admin);
    }

    #[test]
    #[should_panic(expected = "already initialized")]
    fn initialize_twice_panics() {
        let env = Env::default();
        let contract_id = env.register_contract(None, AegisAudit);
        let client = AegisAuditClient::new(&env, &contract_id);
        let admin = Address::generate(&env);
        client.initialize(&admin);
        client.initialize(&admin);
    }

    #[test]
    fn record_decision_emits_event() {
        use soroban_sdk::TryIntoVal;

        let (env, client, _admin) = setup();
        let company_id = BytesN::from_array(&env, &[1u8; 16]);
        let record = DecisionRecord {
            spend_request_id: BytesN::from_array(&env, &[2u8; 16]),
            agent_id: BytesN::from_array(&env, &[3u8; 16]),
            vendor_id: BytesN::from_array(&env, &[4u8; 16]),
            amount_cents: 500_i128,
            asset_code: Symbol::new(&env, "USDC"),
            decision: Decision::Approved,
            reason_hash: BytesN::from_array(&env, &[5u8; 32]),
            timestamp: 1_700_000_000_u64,
            policy_id: BytesN::from_array(&env, &[6u8; 16]),
            policy_version: 1_u32,
        };
        client.record_decision(&company_id, &record);

        let events = env.events().all();
        assert_eq!(events.len(), 1);

        // events() returns Vec<(Address, Vec<Val>, Val)> — (contract_id, topics, data)
        let (_contract_addr, topics, data) = events.first().unwrap();

        // Verify topics: ("aegis", "decision", company_id)
        let topic0: Symbol = topics.get(0).unwrap().try_into_val(&env).unwrap();
        let topic1: Symbol = topics.get(1).unwrap().try_into_val(&env).unwrap();
        let topic2: BytesN<16> = topics.get(2).unwrap().try_into_val(&env).unwrap();
        assert_eq!(topic0, Symbol::new(&env, "aegis"));
        assert_eq!(topic1, Symbol::new(&env, "decision"));
        assert_eq!(topic2, company_id);

        // Verify data round-trips to DecisionRecord
        let emitted: DecisionRecord = data.try_into_val(&env).unwrap();
        assert_eq!(emitted.decision, Decision::Approved);
        assert_eq!(emitted.amount_cents, 500_i128);
    }

    #[test]
    fn set_admin_transfers_role() {
        let (env, client, _admin) = setup();
        let new_admin = Address::generate(&env);
        client.set_admin(&new_admin);
        assert_eq!(client.get_admin(), new_admin);
    }
}
