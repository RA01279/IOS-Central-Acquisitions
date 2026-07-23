import LeaseDealForm from "@/components/LeaseDealForm";
import Nav from "@/components/Nav";
import BackButton from "@/components/BackButton";

export default function NewLeaseDealPage() {
  return (
    <>
      <Nav active="leasing" />
      <main>
        <BackButton />
        <div className="page-header">
          <h1>New lease deal</h1>
        </div>
        <p className="hint">
          Enter the space/prospect. It opens at the <strong>Prospect</strong> stage;
          add the tenant and brokers as contacts from the deal page once it's created.
        </p>
        <LeaseDealForm />
      </main>
    </>
  );
}
