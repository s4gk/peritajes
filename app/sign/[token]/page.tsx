import { SignClientPage } from "./sign-client";

export default function Page({ params }: { params: { token: string } }) {
  return <SignClientPage token={params.token} />;
}
